/**
 * scene08/09 削除 → scene10〜13 を scene08〜11 へ
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const labScenes = path.resolve(__dirname, '../src/scenes');

const pad2 = (n) => String(n).padStart(2, '0');
const sceneLabel = (n) => (n < 10 ? `Scene0${n}` : `Scene${n}`);

function rmDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function renameFileInDir(dir, renamer) {
    for (const name of [...fs.readdirSync(dir)]) {
        const newName = renamer(name);
        if (newName && newName !== name) {
            fs.renameSync(path.join(dir, name), path.join(dir, newName));
        }
    }
}

function replaceInFile(filePath, replacements) {
    let text = fs.readFileSync(filePath, 'utf8');
    for (const [from, to] of replacements) {
        text = text.split(from).join(to);
    }
    fs.writeFileSync(filePath, text, 'utf8');
}

function replaceInDir(dir, replacements) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isFile()) replaceInFile(full, replacements);
    }
}

function applySceneRenumber(fromN, toN) {
    const fromPad = pad2(fromN);
    const toPad = pad2(toN);
    const dir = path.join(labScenes, `scene${toPad}`);
    const fromLabel = sceneLabel(fromN);
    const toLabel = sceneLabel(toN);

    renameFileInDir(dir, (name) =>
        name
            .replace(new RegExp(`^${fromLabel}(\\.|Particle)`, 'i'), `${toLabel}$1`)
            .replace(new RegExp(`^scene${fromPad}\\.`, 'i'), `scene${toPad}.`)
    );

    replaceInDir(dir, [
        [`${fromLabel}Particle`, `${toLabel}Particle`],
        [fromLabel, toLabel],
        [`scene${fromPad}.`, `scene${toPad}.`],
        [`this.sceneNumber = ${fromN};`, `this.sceneNumber = ${toN};`],
    ]);
}

const moves = [
    { from: 13, to: 11 },
    { from: 12, to: 10 },
    { from: 11, to: 9 },
    { from: 10, to: 8 },
];

rmDir(path.join(labScenes, 'scene08'));
rmDir(path.join(labScenes, 'scene09'));

for (const { from } of moves) {
    fs.renameSync(
        path.join(labScenes, `scene${pad2(from)}`),
        path.join(labScenes, `_tmp${pad2(from)}`)
    );
}

for (const { from, to } of moves) {
    fs.renameSync(
        path.join(labScenes, `_tmp${pad2(from)}`),
        path.join(labScenes, `scene${pad2(to)}`)
    );
    applySceneRenumber(from, to);
}

replaceInFile(path.join(labScenes, 'scene10/Scene10.snakeMain.js'), [
    ["from '../scene10/scene10.helpers.js'", "from '../scene08/scene08.helpers.js'"],
]);
replaceInFile(path.join(labScenes, 'scene10/Scene10.js'), [
    ["from '../scene09/scene09.room.js'", "from '../scene09/scene09.room.js'"],
    ["from '../scene11/scene11.room.js'", "from '../scene09/scene09.room.js'"],
    ["from '../scene11/scene11.motion.js'", "from '../scene09/scene09.motion.js'"],
    ["from '../scene11/scene11.helpers.js'", "from '../scene09/scene09.helpers.js'"],
]);
replaceInFile(path.join(labScenes, 'scene11/Scene11.js'), [
    ["from '../scene11/scene11.room.js'", "from '../scene09/scene09.room.js'"],
    ["from '../scene11/scene11.motion.js'", "from '../scene09/scene09.motion.js'"],
    ["from '../scene12/scene12.snakeMain.js'", "from '../scene10/scene10.snakeMain.js'"],
    ["from '../scene11/scene11.helpers.js'", "from '../scene09/scene09.helpers.js'"],
]);

console.log('Done: 11 scenes (scene01-11), deleted old scene08/09');
