/**
 * mavrx4 scene12-22 → mavrx4-lab scene01-11
 * mavrx4-lab scene01-04 → scene12-15
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const labScenes = path.resolve(__dirname, '../src/scenes');
const mavrx4Scenes = path.resolve(__dirname, '../../mavrx4/src/scenes');

const pad2 = (n) => String(n).padStart(2, '0');

function sceneLabel(n) {
    return n < 10 ? `Scene0${n}` : `Scene${n}`;
}

function renameFileInDir(dir, renamer) {
    for (const name of fs.readdirSync(dir)) {
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
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isFile()) {
            replaceInFile(full, replacements);
        }
    }
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dest, name);
        if (fs.statSync(s).isDirectory()) {
            copyDir(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

// --- Step 1: old lab scene01-04 → scene12-15 (reverse order) ---
const oldMoves = [
    { from: 4, to: 15 },
    { from: 3, to: 14 },
    { from: 2, to: 13 },
    { from: 1, to: 12 },
];

for (const { from, to } of oldMoves) {
    const fromPad = pad2(from);
    const toPad = pad2(to);
    const fromDir = path.join(labScenes, `scene${fromPad}`);
    const toDir = path.join(labScenes, `scene${toPad}`);
    fs.renameSync(fromDir, toDir);

    renameFileInDir(toDir, (name) => {
        return name
            .replace(new RegExp(`^Scene${from}(\\.|Particle)`, 'i'), `Scene${toPad}$1`)
            .replace(new RegExp(`^scene${from}\\.`, 'i'), `scene${toPad}.`);
    });

    const fromLabel = sceneLabel(from);
    const toLabel = sceneLabel(to);
    replaceInDir(toDir, [
        [`Scene${from}Particle`, `${toLabel}Particle`],
        [`Scene${from}`, toLabel],
        [`scene${from}.`, `scene${toPad}.`],
        [`this.sceneNumber = ${from};`, `this.sceneNumber = ${to};`],
        [`Scene ${from}:`, `${toLabel}:`],
    ]);
}

// --- Step 2: mavrx4 scene12-22 → lab scene01-11 ---
const importMoves = [
    { from: 12, to: 1 },
    { from: 13, to: 2 },
    { from: 14, to: 3 },
    { from: 15, to: 4 },
    { from: 16, to: 5 },
    { from: 17, to: 6 },
    { from: 18, to: 7 },
    { from: 19, to: 8 },
    { from: 20, to: 9 },
    { from: 21, to: 10 },
    { from: 22, to: 11 },
];

for (const { from, to } of importMoves) {
    const fromPad = pad2(from);
    const toPad = pad2(to);
    const srcDir = path.join(mavrx4Scenes, `scene${fromPad}`);
    const destDir = path.join(labScenes, `scene${toPad}`);
    copyDir(srcDir, destDir);

    renameFileInDir(destDir, (name) => {
        return name
            .replace(new RegExp(`^Scene${fromPad}(\\.|Particle)`, 'i'), `${sceneLabel(to)}$1`)
            .replace(new RegExp(`^Scene${from}(\\.|Particle)`, 'i'), `${sceneLabel(to)}$1`);
    });

    const fromLabel = sceneLabel(from);
    const toLabel = sceneLabel(to);
    replaceInDir(destDir, [
        [`${fromLabel}Particle`, `${toLabel}Particle`],
        [fromLabel, toLabel],
        [`this.sceneNumber = ${from};`, `this.sceneNumber = ${to};`],
    ]);
}

// --- Step 3: cross-scene imports (after renumbering) ---
const crossRefs = [
    {
        file: path.join(labScenes, 'scene08/Scene08.js'),
        replacements: [
            ["from '../scene14/Scene14Particle.js'", "from '../scene03/Scene03Particle.js'"],
            ['Scene14Particle', 'Scene03Particle'],
        ],
    },
    {
        file: path.join(labScenes, 'scene09/Scene09.js'),
        replacements: [
            ["from '../scene16/Scene16Particle.js'", "from '../scene05/Scene05Particle.js'"],
            ['Scene16Particle', 'Scene05Particle'],
        ],
    },
    {
        file: path.join(labScenes, 'scene10/Scene10.js'),
        replacements: [
            ["from '../scene16/Scene16Particle.js'", "from '../scene05/Scene05Particle.js'"],
            ['Scene16Particle', 'Scene05Particle'],
        ],
    },
    {
        file: path.join(labScenes, 'scene11/Scene11.js'),
        replacements: [
            ["from '../scene13/Scene13Particle.js'", "from '../scene02/Scene02Particle.js'"],
            ['Scene13Particle', 'Scene02Particle'],
        ],
    },
];

for (const { file, replacements } of crossRefs) {
    if (fs.existsSync(file)) {
        replaceInFile(file, replacements);
    }
}

console.log('Migration complete: 15 scenes (scene01-11 imported, scene12-15 renumbered).');
