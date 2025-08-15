require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const DATA_FILE = './gameData.json';
const BUILDINGS_FILE = './buildings.json';

const ADMINS = new Set([
  '887170337635205141',
  '1202944954192633897',
]);
const baseCellCost = { дерево: 400, камень: 250, железо: 100, еда: 15 };

const VALID_RESOURCES = new Set([
  'дерево',
  'камень',
  'железо',
  'еда',
  'единица_изучения',
  'уголь',
  'золото',
  'бетон',
]);

// Загрузка данных о постройках из JSON
function loadBuildings() {
  try {
    const data = fs.readFileSync(BUILDINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Ошибка загрузки файла построек:', err);
    return { tier1: {}, tier2: {} };
  }
}

const buildings = loadBuildings();

function createSkeletonArmy() {
  const count = Math.floor(Math.random() * 7) + 4;
  const hpOne = 2;
  const damageOne = 2;
  return {
    тип: 'армия_скелетов',
    количество: count,
    хп: Array(count).fill(hpOne),
    урон: damageOne,
    дебафы: {},
  };
}

function loadData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { игроки: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function usedCapacity(cell) {
  return cell.постройки.reduce((sum, b) => sum + b.емкость, 0);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log(`Бот запущен как ${client.user.tag}`);
});

function applyBleeding(enemy) {
  for (let i = 0; i < enemy.хп.length; i++) {
    if (enemy.дебафы[i] && enemy.дебафы[i] > 0) {
      enemy.хп[i] -= 1;
      enemy.дебафы[i] -= 1;
      if (enemy.хп[i] <= 0) {
        enemy.хп[i] = 0;
      }
    }
  }
}

function towersAttack(player) {
  const enemies = player.враги || [];

  for (const cell of player.клетки) {
    const barricadesCount = cell.постройки.filter(b => 
      b.ключ === 'деревянная_баррикада' ||
      b.ключ === 'деревянно_каменная_баррикада' ||
      b.ключ === 'усиленная_стена' ||
      b.ключ === 'железобетонная_стена' ||
      b.ключ === 'каменная_баррикада'
    ).length;

    for (const building of cell.постройки) {
      if (!building.активна) continue;
      const bInfo = buildings.tier1[building.ключ] || buildings.tier2[building.ключ] || {};

      if (bInfo.тип === 'Башня' && bInfo.урон) {
        if (building.ключ === 'балиста') {
          if ((player.ресурсы.дерево || 0) >= bInfo.тратаДереваЗаВыстрел) {
            player.ресурсы.дерево -= bInfo.тратаДереваЗаВыстрел;
            enemies.forEach(enemy => {
              if (enemy.тип === 'армия_скелетов') {
                for (let i = 0; i < enemy.хп.length; i++) {
                  if (enemy.хп[i] > 0) {
                    enemy.хп[i] -= bInfo.урон;
                    if (enemy.хп[i] < 0) enemy.хп[i] = 0;
                    break;
                  }
                }
              }
            });
          }
        } else {
          enemies.forEach(enemy => {
            if (enemy.тип === 'армия_скелетов') {
              for (let i = 0; i < enemy.хп.length; i++) {
                if (enemy.хп[i] > 0) {
                  enemy.хп[i] -= bInfo.урон;
                  if (enemy.хп[i] < 0) enemy.хп[i] = 0;
                  break;
                }
              }
            }
          });
        }
      }
    }
  }
}

async function enemiesAttack(player, channel) {
  const enemies = player.враги || [];
  const messages = [];

  for (const enemy of enemies) {
    if (enemy.тип === 'армия_скелетов') {
      for (let i = 0; i < enemy.хп.length; i++) {
        if (enemy.хп[i] <= 0) continue;

        const cell = player.клетки[0];
        if (!cell || cell.постройки.length === 0) continue;

        const aliveBuildings = cell.постройки.filter(
          b => b.прочность !== null && b.прочность > 0
        );
        if (aliveBuildings.length === 0) continue;

        const defenseBuildings = aliveBuildings.filter(
          b => b.тип === 'Оборона'
        );

        let target;
        if (defenseBuildings.length > 0) {
          target = defenseBuildings[Math.floor(Math.random() * defenseBuildings.length)];
        } else {
          target = aliveBuildings[Math.floor(Math.random() * aliveBuildings.length)];
        }

        if (target.ключ === 'шипы') {
          if (!enemy.дебафы[i]) enemy.дебафы[i] = 2;
          continue;
        }

        target.прочность -= enemy.урон;
        if (target.прочность < 0) target.прочность = 0;

        messages.push(`🏗️ "${target.имя}" получила урон!`);
      }
    }
  }

  if (messages.length > 0) {
    await channel.send(messages.join('\n'));
  }
}

function removeDestroyedBuildings(player) {
  for (const cell of player.клетки) {
    const toRemove = [];
    for (const building of cell.постройки) {
      if (building.прочность !== null && building.прочность <= 0) {
        toRemove.push(building);
      }
    }

    for (const b of toRemove) {
      const idx = cell.постройки.indexOf(b);
      if (idx !== -1) cell.постройки.splice(idx, 1);
    }
  }
}

function removeDeadEnemies(player) {
  if (!player.враги) return;
  player.враги = player.враги.filter(enemy => {
    if (enemy.тип === 'армия_скелетов') {
      const aliveCount = enemy.хп.filter(hp => hp > 0).length;
      return aliveCount > 0;
    }
    return true;
  });
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  let data = loadData();

  if (command === '!инфо') {
    if (args.length === 0) {
      return message.channel.send('❗ Укажите название постройки. Пример: !инфо лесопилка');
    }
    const name = args.join(' ').toLowerCase();

    let building = buildings.tier1[name] || buildings.tier2[name];
    if (!building) {
      return message.channel.send(`❌ Постройка "${name}" не найдена.`);
    }

    const info = `🏗️ **${building.имя}**\n` +
                 `Емкость: ${building.емкость} Е.П.\n` +
                 `Стоимость:\n` +
                 Object.entries(building.стоимость).map(([res, val]) => `- ${res}: ${val}`).join('\n') + `\n` +
                 `Прочность: ${building.прочность}\n` +
                 (building.интервал ? `Интервал производства: ${building.интервал} ходов\n` : '') +
                 (building.описание ? `Описание: ${building.описание}` : '');

    return message.channel.send(info);
  }

  if (command === '!старт') {
    if (args[0] && args[0].toLowerCase() === 'новая') {
      data.игроки[message.author.id] = {
        ход: 1,
        ресурсы: { дерево: 150, камень: 125, железо: 40, еда: 0, кожа: 0, бетон: 0, уголь: 0, золото: 0, единица_изучения: 0 },
        клетки: [{ емкость: 20, постройки: [] }],
        враги: [],
      };
      saveData(data);
      return message.channel.send('🎮 Новая игра началась! Ваше старое сохранение было удалено и перезаписано.');
    } else if (data.игроки[message.author.id]) {
      return message.channel.send(
        `⚠ У вас уже есть сохранённая игра, @${message.author.username}.\n` +
        'Напишите **!старт новая**, чтобы начать заново и стереть старое сохранение.'
      );
    } else {
      data.игроки[message.author.id] = {
        ход: 1,
        ресурсы: { дерево: 150, камень: 125, железо: 40, еда: 0 },
        клетки: [{ емкость: 20, постройки: [] }],
        враги: [],
      };
      saveData(data);
      return message.channel.send(
        '🎮 Игра началась! У вас есть 1 клетка с лимитом 20 Е.П. и стартовые ресурсы. Для просмотра команд пропишите **!команды.**'
      );
    }
  }

  if (command === '!ход') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    player.ход += 1;

    if (!player.враги || player.враги.length === 0) {
      player.враги = [createSkeletonArmy()];
      await message.channel.send('⚠️ На вашу базу напала армия скелетов!');
    }

    const income = {
      единица_изучения: 0,
      дерево: 0,
      камень: 0,
      железо: 0,
      еда: 0,
      кожа: 0,
      бетон: 0,
      уголь: 0,
      золото: 0
    };

    for (const cell of player.клетки) {
      for (const building of cell.постройки) {
        const bInfo = buildings.tier1[building.ключ] || buildings.tier2[building.ключ] || null;
        if (!bInfo) continue;

        // Проверка интервала для производства
        let canProduce = true;
        if (bInfo.интервал) {
          if (!building.последний_ход) {
            building.последний_ход = player.ход;
          } else {
            canProduce = (player.ход - building.последний_ход) >= bInfo.интервал;
          }
        }

        if (canProduce) {
          if (bInfo.добыча) {
            for (const [res, val] of Object.entries(bInfo.добыча)) {
              income[res] = (income[res] || 0) + val;
            }
            if (bInfo.интервал) {
              building.последний_ход = player.ход;
            }
          }
        }

        if (bInfo.тратитПрочностьЗаХод && building.прочность !== null) {
          building.прочность -= 1;
          if (building.прочность < 0) building.прочность = 0;
        }
      }
    }

    towersAttack(player);
    await enemiesAttack(player, message.channel);
    player.враги.forEach(applyBleeding);
    removeDestroyedBuildings(player);
    removeDeadEnemies(player);

    for (const [res, val] of Object.entries(income)) {
      player.ресурсы[res] = (player.ресурсы[res] || 0) + val;
    }

    saveData(data);

    let reply = `⏳ Ход ${player.ход} завершён!\n\nДоход за ход:\n`;
    if (income.дерево) reply += `🌲 Дерево: +${income.дерево}\n`;
    if (income.камень) reply += `🪨 Камень: +${income.камень}\n`;
    if (income.железо) reply += `⛓ Железо: +${income.железо}\n`;
    if (income.еда) reply += `🍖 Еда: +${income.еда}\n`;
    if (income.единица_изучения) reply += `🔬 Единица изучения: +${income.единица_изучения}\n`;
    if (income.уголь) reply += `⚫ Уголь: +${income.уголь}\n`;
    if (income.золото) reply += `🏆 Золото: +${income.золото}\n`;
    if (income.бетон) reply += `🧱 Бетон: +${income.бетон}\n`;
    if (income.кожа) reply += `🦴 Кожа: +${income.кожа}\n`;

    if (player.враги.length > 0) {
      player.враги.forEach((enemy, idx) => {
        if (enemy.тип === 'армия_скелетов') {
          const aliveCount = enemy.хп.filter(hp => hp > 0).length;
          reply += `\n☠️ Армия скелетов #${idx + 1}: ${aliveCount} из ${enemy.хп.length} живых`;
        }
      });
    }

    return message.channel.send(reply);
  }

  if (command === '!купитьклетку') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    const nextCellNumber = player.клетки.length + 1;

    const cost = {
      дерево: baseCellCost.дерево * nextCellNumber,
      камень: baseCellCost.камень * nextCellNumber,
      железо: baseCellCost.железо * nextCellNumber,
      еда: baseCellCost.еда * nextCellNumber,
    };

    for (const [res, price] of Object.entries(cost)) {
      if ((player.ресурсы[res] || 0) < price) {
        return message.channel.send(`❌ Не хватает ресурсов для покупки клетки ${nextCellNumber}: ${res} (нужно ${price})`);
      }
    }

    // Списываем ресурсы
    for (const [res, price] of Object.entries(cost)) {
      player.ресурсы[res] -= price;
    }

    // Добавляем новую клетку
    player.клетки.push({ емкость: 20, постройки: [] });

    saveData(data);

    return message.channel.send(`✅ Клетка ${nextCellNumber} успешно куплена за: дерево ${cost.дерево}, камень ${cost.камень}, железо ${cost.железо}!`);
  }

  if (command === '!ресурсы') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    const res = player.ресурсы;
    return message.channel.send(
      `📦 **Ваши ресурсы:**\n` +
      `🌲 Дерево: ${res.дерево}\n` +
      `🪨 Камень: ${res.камень}\n` +
      `⛓ Железо: ${res.железо}\n` +
      `🍖 Еда: ${res.еда}\n` +
      `📘 Единица изучения: ${res.единица_изучения}\n` +
      `⚫ Уголь: ${res.уголь}\n` +
      `🪙 Золото: ${res.золото}\n` +
      `🧱 Бетон: ${res.бетон}`
    );
  }

  if (command === '!клетки') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    if (player.клетки.length === 0) {
      return message.channel.send('У вас пока нет клеток.');
    }

    let reply = `🏠 **Ваши клетки:**\n`;

    player.клетки.forEach((cell, i) => {
      const занято = usedCapacity(cell);
      const income = {};
      let brokenBuildings = [];

      for (const b of cell.постройки) {
        const bInfo = buildings.tier1[b.ключ] || buildings.tier2[b.ключ] || null;
        if (bInfo && bInfo.добыча) {
          for (const [res, val] of Object.entries(bInfo.добыча)) {
            income[res] = (income[res] || 0) + val;
          }
        }
        if (bInfo && bInfo.тратитПрочностьЗаХод && b.прочность !== null && b.прочность <= 2) {
          brokenBuildings.push(b.имя);
        }
      }

      reply += `\n**Клетка ${i + 1}** (${занято}/${cell.емкость} Е.П.)\nПроизводство за ход:\n`;

      const icons = {
        дерево: '🌲',
        камень: '🪨',
        железо: '⛓',
        еда: '🍖',
        единица_изучения: '📚',
        уголь: '⚫',
        золото: '🏆',
        бетон: '🧱'
      };

      const prodLines = [];
      for (const [res, val] of Object.entries(income)) {
        if (val > 0) {
          prodLines.push(`  ${icons[res] || ''} ${res.charAt(0).toUpperCase() + res.slice(1)}: +${val}`);
        }
      }
      if (prodLines.length === 0) prodLines.push('  — нет производства');
      reply += prodLines.join('\n') + '\n';

      if (brokenBuildings.length > 0) {
        reply += `⚠️ Через 2 или меньше ходов сломается:\n  ${[...new Set(brokenBuildings)].join(', ')}\n`;
      }
    });

    if (player.враги && player.враги.length > 0) {
      reply += `\n☠️ **Враги на клетках:**\n`;

      const enemyGroups = {};
      for (const enemy of player.враги) {
        if (!enemy.тип) continue;
        const hpOne = enemy.хп.length > 0 ? enemy.хп[0] : 0;
        const key = `${enemy.тип}||${hpOne}||${enemy.урон}`;
        if (!enemyGroups[key]) enemyGroups[key] = { enemy, count: 0, totalHP: 0 };
        const aliveCount = enemy.хп.filter(hp => hp > 0).length;
        enemyGroups[key].count += aliveCount;
        enemyGroups[key].totalHP += enemy.хп.reduce((a, v) => a + v, 0);
      }

      for (const [key, group] of Object.entries(enemyGroups)) {
        const [тип, hpOne, урон] = key.split('||');
        reply += `\n[${тип.replace(/_/g, ' ')}]\nКоличество: ${group.count}\nХП у одного: ${hpOne}\nОбщее ХП: ${group.totalHP}\nУрон за ход (общий): ${group.count * parseInt(урон)}\n`;
      }
    } else {
      reply += `\nНа ваших клетках нет врагов.`;
    }

    return message.channel.send(reply);
  }

  if (command === '!оклетке') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    const cellIndex = parseInt(args[0], 10) - 1;
    if (isNaN(cellIndex) || cellIndex < 0 || cellIndex >= player.клетки.length) {
      return message.channel.send('❌ Укажите корректный номер клетки.');
    }

    const cell = player.клетки[cellIndex];
    let reply = `🏠 **Клетка ${cellIndex + 1}:**\n`;

    if (cell.постройки.length === 0) {
      reply += '  — Пусто\n';
    } else {
      cell.постройки.forEach((b, i) => {
        reply += `  ${i + 1}. ${b.имя} — HP: ${b.прочность === null ? '∞' : b.прочность}\n`;
      });
    }

    return message.channel.send(reply);
  }

  if (command === '!список') {
    const tierArg = args[0] ? args[0].toLowerCase() : '1';

    if (tierArg === '1' || tierArg === 'тир1' || tierArg === 'тиp1') {
      let reply = `📋 **Постройки тира 1:**\n\n`;
      for (const b of Object.values(buildings.tier1)) {
        const costStr = Object.entries(b.стоимость)
          .map(([res, amt]) => `${amt} ${res}`)
          .join(', ');
        reply += `- ${b.имя} — ${b.емкость} Е.П., прочность: ${
          b.прочность === null ? '∞' : b.прочность
        }, стоимость: ${costStr}\n`;
      }
      return message.channel.send(reply);
    }

    if (tierArg === '2' || tierArg === 'тир2' || tierArg === 'тиp2') {
      let reply = `📋 **Постройки тира 2:**\n\n`;
      for (const b of Object.values(buildings.tier2)) {
        const costStr = Object.entries(b.стоимость)
          .map(([res, amt]) => `${amt} ${res}`)
          .join(', ');
        reply += `- ${b.имя} — ${b.емкость} Е.П., прочность: ${
          b.прочность === null ? '∞' : b.прочность
        }, стоимость: ${costStr}\n`;
      }
      return message.channel.send(reply);
    }
  }

  if (command === '!построить') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    if (args.length === 0) {
      return message.channel.send('❌ Укажите название постройки.');
    }

    let cellIndex = 0;
    let buildingNameParts = args;

    const lastArg = args[args.length - 1].toLowerCase();
    if (lastArg.startsWith('клетка')) {
      const match = lastArg.match(/клетка\s*(\d+)/) || lastArg.match(/клетка(\d+)/);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > 0 && num <= player.клетки.length) {
          cellIndex = num - 1;
          buildingNameParts = args.slice(0, -1);
        } else {
          return message.channel.send(`❌ Клетка ${num} не найдена.`);
        }
      } else {
        return message.channel.send('❌ Неверный формат названия клетки. Пример: клетка 1');
      }
    }

    const buildingName = buildingNameParts.join(' ').toLowerCase();
    let buildingTemplate = buildings.tier1[buildingName] || buildings.tier2[buildingName];
    if (!buildingTemplate) {
      return message.channel.send('❌ Неизвестное здание.');
    }

    const cell = player.клетки[cellIndex];
    const usedCap = usedCapacity(cell);

    if (usedCap + buildingTemplate.емкость > cell.емкость) {
      return message.channel.send(`❌ В клетке ${cellIndex + 1} не хватает места для ${buildingTemplate.имя}.`);
    }

    const countSame = cell.постройки.filter(b => b.ключ === buildingTemplate.ключ).length;

    if (buildingTemplate.лимитЗависитОтБаррикад) {
      const defenseCount = cell.постройки.filter(b => b.тип === 'Оборона').length;
      if (countSame >= defenseCount) {
        return message.channel.send(`❌ Лимит построек "${buildingTemplate.имя}" зависит от количества оборонительных сооружений (${defenseCount}). Лимит достигнут.`);
      }
    } else {
      if (countSame >= buildingTemplate.лимитНаКлетку) {
        return message.channel.send(`❌ Лимит построек "${buildingTemplate.имя}" на клетку достигнут.`);
      }
    }

    const missingResources = {};
    for (const [res, cost] of Object.entries(buildingTemplate.стоимость)) {
      const playerRes = player.ресурсы[res] || 0;
      if (playerRes < cost) {
        missingResources[res] = cost - playerRes;
      }
    }
    if (Object.keys(missingResources).length > 0) {
      let msg = '❌ Не хватает ресурсов:\n';
      for (const [res, deficit] of Object.entries(missingResources)) {
        msg += `${res.charAt(0).toUpperCase() + res.slice(1)}: ${deficit}\n`;
      }
      return message.channel.send(msg);
    }

    for (const [res, cost] of Object.entries(buildingTemplate.стоимость)) {
      player.ресурсы[res] -= cost;
    }

    cell.постройки.push({
      ключ: buildingTemplate.ключ,
      имя: buildingTemplate.имя,
      емкость: buildingTemplate.емкость,
      прочность: buildingTemplate.прочность === null ? null : buildingTemplate.прочность,
      активна: true,
      тип: buildingTemplate.тип || null,
    });

    saveData(data);
    return message.channel.send(`✅ Построена ${buildingTemplate.имя} в клетке ${cellIndex + 1}!`);
  }

  if (command === '!удалить') {
    const player = data.игроки[message.author.id];
    if (!player) return message.channel.send('❌ Сначала начните игру командой !старт');

    if (args.length === 0) {
      return message.channel.send('❗ Укажите название постройки для удаления. Пример: !удалить лесопилка');
    }

    let cellIndex = 0;
    let buildingNameParts = args;

    const lastArg = args[args.length - 1].toLowerCase();
    if (lastArg.startsWith('клетка')) {
      const match = lastArg.match(/клетка\s*(\d+)/) || lastArg.match(/клетка(\d+)/);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > 0 && num <= player.клетки.length) {
          cellIndex = num - 1;
          buildingNameParts = args.slice(0, -1);
        } else {
          return message.channel.send(`❌ Клетка ${num} не найдена.`);
        }
      } else {
        return message.channel.send('❌ Неверный формат клетки. Пример: клетка 1');
      }
    }

    const buildingName = buildingNameParts.join(' ').toLowerCase();
    const buildingTemplate = buildings.tier1[buildingName] || buildings.tier2[buildingName];
    if (!buildingTemplate) {
      return message.channel.send(`❌ Постройка "${buildingName}" не найдена.`);
    }

    const cell = player.клетки[cellIndex];
    if (!cell) return message.channel.send('❌ Клетка не найдена.');

    const idx = cell.постройки.findIndex(b => b.ключ === buildingTemplate.ключ);
    if (idx === -1) {
      return message.channel.send(`❌ В клетке ${cellIndex + 1} не найдена постройка "${buildingTemplate.имя}".`);
    }

    cell.постройки.splice(idx, 1);
    saveData(data);
    return message.channel.send(`✅ Постройка "${buildingTemplate.имя}" удалена из клетки ${cellIndex + 1}.`);
  }

  if (command === '!оигроке') {
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      return message.channel.send('❗ Укажите игрока через упоминание. Пример: !оигроке @ник');
    }

    const playerId = mentionedUser.id;
    let playerData = data.игроки[playerId];
    if (!playerData) {
      return message.channel.send(`❌ Информация об игроке ${mentionedUser.username} не найдена.`);
    }

    let reply = `📊 Информация об игроке ${mentionedUser}:\n`;
    reply += `Ход: ${playerData.ход}\n`;
    reply += `Ресурсы: ${Object.entries(playerData.ресурсы).map(([res, val]) => `${res}: ${val}`).join(', ')}\n`;
    reply += `Клеток: ${playerData.клетки.length}\n`;

    return message.channel.send(reply);
  }

  if (command === '!команды') {
    const cmds = [
      '**!оигре** — показывает информацию о игре',
      '**!старт** — начинает новую игру',
      '**!ресурсы** — показывает ресурсы',
      '**!клетки** — показывает информацию всех клеток и события (если есть)',
      '**!оклетке [номер]** — показывает информацию конкретной клетки',
      '**!купитьклетку** — покупка новой клетки за определённую стоимость',
      '**!список [1|2]** — показывает список построек по тиру',
      '**!инфо [название]** — показывает информацию о постройке',
      '**!построить [название постройки] [номер клетки]** — строит здание (по умолчанию в клетке 1)',
      '**!ход** — запускает следующий ход',
      '**!изменение** — показывает changelog',
      '**!команды** — показывает это меню',
      '**!админы** — показывает админов',
      '**!удалить [название постройки] [номер клетки]** — удаляет одну указанную постройку',
      '**!оигроке [@упоминание]** — показывает информацию о игроке если есть'
    ];
    return message.channel.send('📜 **Доступные команды:**\n' + cmds.join('\n'));
  }

  if (command === '!оигре') {
    const infoMessage =
      `🎮 **О игре** 🎮\n\n` +
      `Это текстовая стратегия с постройками и обороной вашей базы.\n` +
      `Вы строите разные здания, добываете ресурсы и отражаете атаки врагов (например, армий скелетов).\n\n` +
      `🛠️ **Другое:**\n` +
      `- !старт — начать новую игру или перезаписать старое сохранение\n` +
      `- Е.П. — это Единицы Пространства\n` +
      `- Игра все еще в Бете, ждите обновлений\n` +
      `- Если вы читаете это, то вы в Альфа-тесте\n` +
      `- Здесь был: @akulasever\n` +
      `- Здесь был: @val_l2011_76994\n` +
      `- У меня нет идей, что здесь писать. Удачи!\n` +
      `- Автор игры: @color_and_colour\n` +
      `- В игре очень много как орфографических, так и технических ошибок\n` +
      `- Версия игры: [0.2.4] (Beta WIP)\n\n` +
      `Цель игры — выжить как можно дольше, развивая базу и отражая атаки.\n\n` +
      `Если хотите список команд — используйте !команды`;

    return message.channel.send(infoMessage);
  }

  if (command.startsWith('!изменение')) {
    const args = command.split(' ').slice(1);

    if (args.length > 0 && args[0].toLowerCase() === 'фулл') {
      message.channel.send({
        files: [{
          attachment: './fullchangelogs.txt',
          name: 'fullchangelogs.txt'
        }]
      }).catch(err => {
        console.error(err);
        message.channel.send('Не удалось отправить полный список изменений.');
      });
    } else {
      fs.readFile('./changelog.txt', 'utf8', (err, data) => {
        if (err) {
          console.error(err);
          message.channel.send('Не удалось загрузить список последних изменений.');
          return;
        }

        message.channel.send(`🎮 **🛠️ Последние изменения:** 🎮\n\n${data}`);
      });
    }
  }

  // Функция проверки прав
  function isAdmin(userId) {
    return ADMINS.has(userId);
  }

  // Команды, которые доступны только админам
  const adminCommands = new Set(['стереть', 'забрать', 'выдать']);

  // Если команда админская, но пользователь не админ — блокируем
  if (adminCommands.has(command) && !isAdmin(message.author.id)) {
    return message.channel.send('❌ Команда доступна только администраторам.');
  }

  if (command === 'стереть') {
    if (args.length === 0) {
      return message.channel.send('❗ Укажите, что хотите стереть. Например: стереть мир или стереть @ник');
    }

    if (args[0].toLowerCase() === 'мир') {
      const embed = new EmbedBuilder()
        .setDescription('✨ Да будет так! ✨')
        .setImage('https://tenor.com/view/no-more-deals-undertale-chara-shattered-soul-broken-gif-6615800318398858463');
      return message.channel.send({ embeds: [embed] });
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      return message.channel.send('❗ Укажите игрока через упоминание. Пример: стереть @ник');
    }

    const playerId = mentionedUser.id;
    if (!data.игроки[playerId]) {
      return message.channel.send(`❌ Сохранение игрока ${mentionedUser.username} не найдено.`);
    }

    delete data.игроки[playerId];
    saveData(data);
    return message.channel.send(`✅ Сохранение игрока ${mentionedUser.username} успешно стерто.`);
  }

  if (command === 'забрать') {
    if (args.length < 3) {
      return message.channel.send('❗ Формат: !забрать [ресурс] [кол-во] [@ник]');
    }

    const resource = args[0].toLowerCase();
    if (!VALID_RESOURCES.has(resource)) {
      return message.channel.send(`❌ Неверный ресурс. Доступные: ${[...VALID_RESOURCES].join(', ')}`);
    }

    const amount = parseInt(args[1], 10);
    if (isNaN(amount) || amount <= 0) {
      return message.channel.send('❌ Количество должно быть положительным числом.');
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      return message.channel.send('❗ Укажите игрока через упоминание. Пример: !забрать дерево 100 @ник');
    }

    const playerId = mentionedUser.id;
    const playerData = data.игроки[playerId];
    if (!playerData) {
      return message.channel.send(`❌ Игрок ${mentionedUser.username} не найден.`);
    }

    playerData.ресурсы[resource] = (playerData.ресурсы[resource] || 0) - amount;
    if (playerData.ресурсы[resource] < 0) playerData.ресурсы[resource] = 0;
    saveData(data);

    return message.channel.send(`✅ У игрока ${mentionedUser} отнято ${amount} ${resource}.`);
  }

  if (command === 'выдать') {
    if (args.length < 3) {
      return message.channel.send('❗ Формат: !выдать [ресурс] [кол-во] [@ник]');
    }

    const resource = args[0].toLowerCase();
    if (!VALID_RESOURCES.has(resource)) {
      return message.channel.send(`❌ Неверный ресурс. Доступные: ${[...VALID_RESOURCES].join(', ')}`);
    }

    const amount = parseInt(args[1], 10);
    if (isNaN(amount) || amount <= 0) {
      return message.channel.send('❌ Количество должно быть положительным числом.');
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      return message.channel.send('❗ Укажите игрока через упоминание. Пример: !выдать дерево 100 @ник');
    }

    const playerId = mentionedUser.id;
    const playerData = data.игроки[playerId];
    if (!playerData) {
      return message.channel.send(`❌ Игрок ${mentionedUser.username} не найден.`);
    }

    playerData.ресурсы[resource] = (playerData.ресурсы[resource] || 0) + amount;
    saveData(data);

    return message.channel.send(`✅ Игроку ${mentionedUser} выдано ${amount} ${resource}.`);
  }

  if (command === '!админы') {
    if (ADMINS.size === 0) {
      return message.channel.send('Список админов пуст.');
    }
    const adminList = [...ADMINS].map(id => `<@${id}>`).join('\n');
    return message.channel.send(`📋 Список администраторов:\n${adminList}`);
  }

});

client.login(process.env.TOKEN);