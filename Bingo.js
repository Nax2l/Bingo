const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    AttachmentBuilder,
    ComponentType
} = require('discord.js');
const mongoose = require('mongoose');
const { createCanvas, loadImage } = require('canvas');

// إعداد الكلاينت
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// إعداد مخطط قاعدة البيانات (MongoDB)
const taskSchema = new mongoose.Schema({
    game: String,
    difficulty: String,
    task: String
}, { collection: 'bingo_tasks' });

const Task = mongoose.model('Task', taskSchema);

// تخزين المباريات النشطة (لمنع أكثر من مباراة في نفس القناة)
const activeGames = new Map();

// دالة مساعدة لتقسيم النص داخل خلايا الكانفاس
function wrapText(ctx, text, maxWidth) {
    if (!text) return ["مهمة غير معروفة"]; 
    
    const safeText = String(text);
    const words = safeText.split(' ');
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        let word = words[i];
        let width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

// دالة التحقق من الفوز
function checkWin(gameState, team) {
    const size = gameState.gridSize === 16 ? 4 : 5;
    const tasks = gameState.tasks;

    const count = tasks.filter(t => t.owner === team).length;
    if (count >= gameState.winCondition) return true;

    for (let r = 0; r < size; r++) {
        let win = true;
        for (let c = 0; c < size; c++) {
            if (tasks[r * size + c].owner !== team) { win = false; break; }
        }
        if (win) return true;
    }

    for (let c = 0; c < size; c++) {
        let win = true;
        for (let r = 0; r < size; r++) {
            if (tasks[r * size + c].owner !== team) { win = false; break; }
        }
        if (win) return true;
    }

    let diag1Win = true;
    let diag2Win = true;
    for (let i = 0; i < size; i++) {
        if (tasks[i * size + i].owner !== team) diag1Win = false; 
        if (tasks[i * size + (size - 1 - i)].owner !== team) diag2Win = false; 
    }
    if (diag1Win || diag2Win) return true;

    return false; 
}

// دالة رسم اللوحة
async function drawBingoBoard(gameState) {
    const templatePath = gameState.gridSize === 16 ? './template_16.png' : './template_25.png';
    const img = await loadImage(templatePath); 
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const is16 = gameState.gridSize === 16;
    const cols = is16 ? 4 : 5;
    const rows = is16 ? 4 : 5;
    
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    for (let i = 0; i < gameState.tasks.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * cellWidth;
        const y = row * cellHeight;
        const cell = gameState.tasks[i];

        // 1. تلوين خلفية الخلية إذا كان لها مالك
        if (cell.owner === 'red') {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.fillRect(x, y, cellWidth, cellHeight);
        } else if (cell.owner === 'blue') {
            ctx.fillStyle = 'rgba(0, 0, 255, 0.8)';
            ctx.fillRect(x, y, cellWidth, cellHeight);
        }

        // 2. كتابة رقم الخلية واسم اللعبة أولاً عشان ما يتأثر بحجم خط المهمة
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = cell.owner ? 'rgba(255, 255, 255, 0.8)' : 'gray';
        ctx.font = "bold 10px Arial";
        
        const gameName = cell.game || 'غير معروف';
        ctx.fillText(`${i + 1} - ${gameName}`, x + 8, y +3 );

        // 3. كتابة النص الرئيسي للمهمة بنظام (التصغير التلقائي Auto-Fit)
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = cell.owner ? 'white' : 'black';
        
        let fontSize = 22; // الحجم المبدئي الكبير
        let lines = [];
        let lineHeight = 25;
        let maxLineWidth = 0;
        
        // المساحة المتاحة عمودياً (حذفنا 35 بكسل لحماية رقم الخلية والحدود السفلية)
        const maxTextHeight = cellHeight - 35; 
        // المساحة المتاحة أفقياً
        const maxTextWidth = cellWidth - 15; 

        // حلقة لتقليل الخط حتى يتناسب 100% داخل المربع
        do {
            ctx.font = `bold ${fontSize}px Arial`;
            lineHeight = Math.floor(fontSize * 1.3); // جعل المسافة بين السطور مناسبة لحجم الخط
            lines = wrapText(ctx, cell.task, maxTextWidth);
            
            // حساب أقصى عرض لسطر واحد في النص
            maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
            
            // إذا كان النص لا يتجاوز الطول ولا العرض، نخرج من الحلقة
            if ((lines.length * lineHeight) <= maxTextHeight && maxLineWidth <= maxTextWidth) {
                break;
            }
            fontSize--; // تصغير الخط درجة واحدة وتجربة الموضوع من جديد
        } while (fontSize > 10); // 10 هو أصغر خط ممكن حتى يظل مقروءاً

        // حساب مكان البداية العمودي ليكون النص في المنتصف بالضبط
        const totalHeight = lines.length * lineHeight;
        const yOffset = 10; // إزاحة بسيطة للأسفل لتجنب الاصطدام باسم اللعبة
        const startY = y + (cellHeight / 2) - (totalHeight / 2) + yOffset;
        
        // رسم الأسطر النهائية
        lines.forEach((line, index) => {
            ctx.fillText(line, x + (cellWidth / 2), startY + (index * lineHeight));
        });
    }

    return new AttachmentBuilder(canvas.toBuffer(), { name: 'bingo.png' });
}

// دالة إنشاء أزرار الخلايا
function generateGridButtons(gameState) {
    const rows = [];
    const totalCells = gameState.gridSize;
    const cols = totalCells === 16 ? 4 : 5; 
    let buttonCount = 0;

    for (let i = 0; i < Math.ceil(totalCells / cols); i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < cols; j++) { 
            if (buttonCount >= totalCells) break;
            
            const cell = gameState.tasks[buttonCount];
            let style = ButtonStyle.Secondary;
            
            if (cell.owner === 'red') style = ButtonStyle.Danger;
            else if (cell.owner === 'blue') style = ButtonStyle.Primary;

            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`cell_${buttonCount}`)
                    .setLabel((buttonCount + 1).toString())
                    .setStyle(style)
            );
            buttonCount++;
        }
        rows.push(row);
    }
    return rows;
}

// دالة بناء رسالة التحكم (Setup Menu)
function buildSetupComponents(gameState, distinctGames) {
    const row1 = new ActionRowBuilder();
    [1, 2, 3, 4].forEach(m => {
        row1.addComponents(
            new ButtonBuilder()
                .setCustomId(`mode_${m}`)
                .setLabel(`${m}v${m}`)
                .setStyle(gameState.mode === m ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    });
    row1.addComponents(
        new ButtonBuilder()
            .setCustomId('cancel_game')
            .setLabel('Quit')
            .setStyle(ButtonStyle.Secondary)
    );

    const gamesToDisplay = [...distinctGames.slice(0, 9), 'random'];
    const gameRows = [];
    let currentRow = new ActionRowBuilder();

    gamesToDisplay.forEach((g) => {
        if (currentRow.components.length === 5) {
            gameRows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        
        const isSelected = gameState.selectedGames.includes(g);
        const labelText = g === 'random' ? 'Random' : g;
        
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`select_game_${g}`)
                .setLabel(labelText)
                .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    });
    if (currentRow.components.length > 0) {
        gameRows.push(currentRow);
    }

    const max = gameState.maxPlayersPerTeam || '-';
    const rowTeams = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('team_red')
            .setLabel(`Red (${gameState.redTeam.size}/${max})`)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!gameState.mode || gameState.redTeam.size >= gameState.maxPlayersPerTeam),
        new ButtonBuilder()
            .setCustomId('team_blue')
            .setLabel(`Blue (${gameState.blueTeam.size}/${max})`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!gameState.mode || gameState.blueTeam.size >= gameState.maxPlayersPerTeam),
        new ButtonBuilder()
            .setCustomId('team_leave')
            .setLabel('Leave')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('start_game')
            .setLabel('Start')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, ...gameRows, rowTeams];
}

// دالة تحديث محتوى الرسالة النصي لعرض أعضاء الفرق
function getSetupMessage(gameState) {
    const redMembers = Array.from(gameState.redTeam).map(id => `<@${id}>`).join(' | ') || 'لا أحد';
    const blueMembers = Array.from(gameState.blueTeam).map(id => `<@${id}>`).join(' | ') || 'لا أحد';
    
    return `**Bingo Lockout Setup**\nالرجاء تحديد النمط والألعاب، ثم الانضمام للفرق والضغط على Start:\n\n` +
           `🔴 **الفريق الأحمر:** ${redMembers}\n` +
           `🔵 **الفريق الأزرق:** ${blueMembers}`;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.content !== 'بينقو') return;

    if (activeGames.has(message.channel.id)) {
        return message.reply("يوجد مباراة نشطة حالياً في هذا الروم. يرجى إنهاؤها أولاً.");
    }

    const distinctGames = await Task.distinct('game');

    const gameState = {
        channelId: message.channel.id,
        host: message.author.id,
        mode: null, 
        maxPlayersPerTeam: 0,
        gridSize: 0,
        winCondition: 0,
        selectedGames: [], 
        redTeam: new Set(),
        blueTeam: new Set(),
        tasks: [],
        isStarted: false
    };

    activeGames.set(message.channel.id, gameState);

    const setupComponents = buildSetupComponents(gameState, distinctGames);

    const gameMessage = await message.channel.send({
        content: getSetupMessage(gameState),
        components: setupComponents
    });

    const collector = gameMessage.createMessageComponentCollector({ time: 3600000 });

    collector.on('collect', async (interaction) => {
        if (!gameState.isStarted && interaction.user.id !== gameState.host && !interaction.customId.startsWith('team_')) {
            return interaction.reply({ content: "صاحب اللعبة فقط يمكنه التحكم في الإعدادات.", ephemeral: true });
        }

        if (interaction.customId === 'cancel_game') {
            activeGames.delete(message.channel.id);
            await gameMessage.delete().catch(()=>কারি);
            return interaction.reply({ content: "تم إلغاء المباراة.", ephemeral: true });
        }

        if (interaction.customId.startsWith('mode_')) {
            const mode = parseInt(interaction.customId.split('_')[1]);
            if (gameState.mode !== mode) {
                gameState.mode = mode;
                gameState.maxPlayersPerTeam = mode;
                
                if (mode <= 2) {
                    gameState.gridSize = 16;
                    gameState.winCondition = 9;
                } else {
                    gameState.gridSize = 25;
                    gameState.winCondition = 13;
                }
                
                gameState.redTeam.clear();
                gameState.blueTeam.clear();
            }

            await interaction.update({ 
                content: getSetupMessage(gameState),
                components: buildSetupComponents(gameState, distinctGames) 
            });
        }

        if (interaction.customId.startsWith('select_game_')) {
            const selected = interaction.customId.replace('select_game_', '');
            
            if (selected === 'random') {
                if (gameState.selectedGames.includes('random')) {
                    gameState.selectedGames = [];
                } else {
                    gameState.selectedGames = ['random'];
                }
            } else {
                gameState.selectedGames = gameState.selectedGames.filter(g => g !== 'random');
                
                if (gameState.selectedGames.includes(selected)) {
                    gameState.selectedGames = gameState.selectedGames.filter(g => g !== selected); 
                } else {
                    gameState.selectedGames.push(selected); 
                }
            }
            
            await interaction.update({ 
                content: getSetupMessage(gameState),
                components: buildSetupComponents(gameState, distinctGames) 
            });
        }

        if (interaction.customId.startsWith('team_')) {
            const action = interaction.customId.split('_')[1];
            const userId = interaction.user.id;

            if (action === 'leave') {
                gameState.redTeam.delete(userId);
                gameState.blueTeam.delete(userId);
            } else if (action === 'red') {
                if (gameState.redTeam.size >= gameState.maxPlayersPerTeam) return interaction.reply({ content: "الفريق الأحمر ممتلئ!", ephemeral: true });
                gameState.blueTeam.delete(userId);
                gameState.redTeam.add(userId);
            } else if (action === 'blue') {
                if (gameState.blueTeam.size >= gameState.maxPlayersPerTeam) return interaction.reply({ content: "الفريق الأزرق ممتلئ!", ephemeral: true });
                gameState.redTeam.delete(userId);
                gameState.blueTeam.add(userId);
            }

            await interaction.update({ 
                content: getSetupMessage(gameState),
                components: buildSetupComponents(gameState, distinctGames) 
            });
        }

        if (interaction.customId === 'start_game') {
            if (!gameState.mode) return interaction.reply({ content: "الرجاء اختيار نمط اللعب (1v1, 2v2...) أولاً!", ephemeral: true });
            if (gameState.selectedGames.length === 0) return interaction.reply({ content: "الرجاء اختيار لعبة واحدة على الأقل!", ephemeral: true });
            
            let rawTasks = [];
            
            if (gameState.selectedGames.includes('random')) {
                rawTasks = await Task.aggregate([{ $sample: { size: gameState.gridSize } }]);
            } else {
                const numGames = gameState.selectedGames.length;
                let remainingSize = gameState.gridSize;

                for (let i = 0; i < numGames; i++) {
                    const game = gameState.selectedGames[i];
                    const take = i === numGames - 1 ? remainingSize : Math.floor(gameState.gridSize / numGames);
                    remainingSize -= take;

                    const gameTasks = await Task.aggregate([
                        { $match: { game: game } },
                        { $sample: { size: take } }
                    ]);
                    rawTasks.push(...gameTasks);
                }
                rawTasks = rawTasks.sort(() => Math.random() - 0.5);
            }

            if (rawTasks.length < gameState.gridSize) {
                return interaction.reply({ content: `لا يوجد مهام كافية في قاعدة البيانات! مطلوب ${gameState.gridSize} مهمة، المتاح فقط ${rawTasks.length}.`, ephemeral: true });
            }

            gameState.tasks = rawTasks.map(t => ({ task: t.task, game: t.game, owner: null }));
            gameState.isStarted = true;

            const attachment = await drawBingoBoard(gameState);
            const gridComponents = generateGridButtons(gameState);

            await interaction.update({ 
                content: `**بدأت المباراة! حظاً موفقاً!**\n\n🔴 الفريق الأحمر: ${Array.from(gameState.redTeam).map(id=>`<@${id}>`).join(' | ') || 'لا أحد'}\n🔵 الفريق الأزرق: ${Array.from(gameState.blueTeam).map(id=>`<@${id}>`).join(' | ') || 'لا أحد'}`, 
                files: [attachment], 
                components: gridComponents 
            });
        }

        if (interaction.customId.startsWith('cell_')) {
            const userId = interaction.user.id;
            let playerTeam = null;

            if (gameState.redTeam.has(userId)) playerTeam = 'red';
            else if (gameState.blueTeam.has(userId)) playerTeam = 'blue';

            if (!playerTeam) {
                return interaction.reply({ content: "أنت لست مشاركاً في أي فريق!", ephemeral: true });
            }

            const cellIndex = parseInt(interaction.customId.split('_')[1]);
            const cell = gameState.tasks[cellIndex];

            if (cell.owner && cell.owner !== playerTeam) {
                return interaction.reply({ content: "هذه الخلية محجوزة للفريق الخصم!", ephemeral: true });
            }

            if (cell.owner === playerTeam) {
                cell.owner = null;
            } else {
                cell.owner = playerTeam;
            }

            const redWins = checkWin(gameState, 'red');
            const blueWins = checkWin(gameState, 'blue');

            if (redWins || blueWins) {
                const winner = redWins ? "الفريق الأحمر 🔴" : "الفريق الأزرق 🔵";
                
                const finalAttachment = await drawBingoBoard(gameState);
                const finalGrid = generateGridButtons(gameState);
                
                finalGrid.forEach(row => row.components.forEach(btn => btn.setDisabled(true)));

                await interaction.update({ 
                    content: `🎉 **انتهت المباراة! الفائز هو: ${winner}** 🎉\n(تحقق شرط الفوز: خط كامل أو الوصول للعدد المطلوب)`, 
                    files: [finalAttachment], 
                    components: finalGrid 
                });

                activeGames.delete(message.channel.id);
                collector.stop();
                return;
            }

            const newAttachment = await drawBingoBoard(gameState);
            const newGrid = generateGridButtons(gameState);

            await interaction.update({ files: [newAttachment], components: newGrid });
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            activeGames.delete(message.channel.id);
            message.channel.send("انتهى وقت المباراة (مرت ساعة). تم تنظيف الروم.");
        }
    });
});

// اتصال بقاعدة البيانات وتشغيل البوت
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB!");
    client.login(process.env.BOT_TOKEN);
}).catch(err => console.error("Database connection error:", err));

client.once('ready', () => {
    console.log(`Bot is online as ${client.user.tag}`);
});
