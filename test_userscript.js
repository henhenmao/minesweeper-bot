// Port-time verification harness for minesweeper.user.js.
// Run manually with: node test_userscript.js
// Mirrors the cases in test_solver.py and test_play.py.
const assert = require("node:assert");
const bot = require("./minesweeper.user.js");

const keys = (set) => [...set].sort();

// -- solve(): same cases as test_solver.py --
{
  const { mines } = bot.solve([[1, -1]], 1);
  assert.deepStrictEqual(keys(mines), ["0,1"], "saturated");
}
{
  const grid = [[0, 1, -1], [0, 1, -1], [0, 1, -1]];
  const { safe, mines } = bot.solve(grid, 1);
  assert.deepStrictEqual(keys(safe), ["0,2", "2,2"], "subset rule safe");
  assert.deepStrictEqual(keys(mines), ["1,2"], "subset rule mines");
}

// -- guess(): same cases as test_solver.py --
{
  const grid = [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 2, 0],
    [-1, -1, -1, -1, -1, -1],
  ];
  const result = bot.guess(grid, 3, new Set(), new Set());
  assert(["2,0", "2,1", "2,2"].includes(result), `guess low-prob component, got ${result}`);
}
{
  const grid = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 2, 0],
    [-1, -1, -1, -1, -1, -1, -1],
  ];
  const result = bot.guess(grid, 3, new Set(), new Set());
  assert.strictEqual(result, "2,3", "guess global mine budget");
}

console.log("solver tests passed");

// -- nextAction(): same cases as test_play.py --
{
  assert.strictEqual(bot.nextAction([[1, bot.MINE]], 1).action, "loss");
  assert.strictEqual(bot.nextAction([[1, 0]], 0).action, "win");
}
{
  const grid = [[0, 1, bot.UNKNOWN], [0, 1, bot.UNKNOWN], [0, 1, bot.UNKNOWN]];
  const { action, cells } = bot.nextAction(grid, 1);
  assert.strictEqual(action, "click");
  assert.deepStrictEqual(cells.map(String).sort(), ["0,2", "2,2"], "safe cells");
}
{
  // solver deduces the last unknown is a mine -> win even though it looks unopened
  assert.strictEqual(bot.nextAction([[1, bot.UNKNOWN]], 1).action, "win", "deduced win");
}
{
  const grid = [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 2, 0],
    [-1, -1, -1, -1, -1, -1],
  ];
  const { action, cells } = bot.nextAction(grid, 3);
  assert.strictEqual(action, "click");
  assert.strictEqual(cells.length, 1);
  assert(["2,0", "2,1", "2,2"].includes(String(cells[0])), "guess fallback");
}

// -- classifyPixel() --
{
  assert.strictEqual(bot.classifyPixel([170, 215, 81]), "green");
  assert.strictEqual(bot.classifyPixel([229, 194, 159]), "tan");
  assert.strictEqual(bot.classifyPixel([42, 10, 10]), "mine"); // sampled from real lost game
  assert.strictEqual(bot.classifyPixel([25, 118, 210]), 1);
  assert.strictEqual(bot.classifyPixel([255, 255, 255]), null);
}

// -- detectDifficulty(): cells are square, so the right grid divides evenly --
{
  assert.strictEqual(bot.detectDifficulty(540, 420).name, "medium"); // real medium canvas is 540x420 CSS
  assert.strictEqual(bot.detectDifficulty(520, 416).name, "easy");   // 10x8 grid of 52px cells
  assert.strictEqual(bot.detectDifficulty(504, 420).name, "hard");   // 24x20 grid of 21px cells
}

// -- readBoard() on a synthetic 1x2 board: green cell then tan cell --
{
  const cell = 30, width = 60, height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = x < cell ? [170, 215, 81] : [229, 194, 159];
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const grid = bot.readBoard({ data, width, height }, 1, 2);
  assert.deepStrictEqual(grid, [[bot.UNKNOWN, 0]], "synthetic readBoard");
}

console.log("all tests passed");
