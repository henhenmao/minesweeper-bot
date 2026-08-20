// ==UserScript==
// @name         Google Minesweeper Bot
// @namespace    henhenmao
// @version      0.1
// @description  Auto-solves Google Minesweeper from a injected Solve button
// @match        https://www.google.com/fbx*
// @match        https://www.google.com/search*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

"use strict";

// constants (same codes as the previous python bot)

const UNKNOWN = -1;
const UNREADABLE = -2;
const MINE = -3;

const DIRECTIONS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]; // all eight neighbors of a given cell

// cells are "r,c" strings inside solver sets
const cellKey = (r, c) => `${r},${c}`;
const parseCell = (key) => key.split(",").map(Number);

// solver
function neighbors(r, c, rows, cols) {
  for (const [i, j] of DIRECTIONS) {
    const nr = r + i, nc = c + j;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) yield [nr, nc];
  }
}

function getConstraints(grid, unknown, safe, mines) {
  // for each numbered cell computes a Map with {key=cells: all unknown cells, val=counts: # of mines in cells}

  const rows = grid.length, cols = grid[0].length;
  const constraints = new Map();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const curr = grid[r][c];
      if (curr <= 0) continue; // skip cells with no number

      const cells = new Set(); // set containing all neighbors of the current cell, excluding safes and mines
      let flagged = 0;
      for (const [nr, nc] of neighbors(r, c, rows, cols)) {
        const key = cellKey(nr, nc);
        if (mines.has(key)) flagged += 1;
        else if (unknown.has(key) && !safe.has(key)) cells.add(key);
      }
      if (cells.size) constraints.set([...cells].sort().join("|"), { cells, count: curr - flagged });
    }
  }
  return [...constraints.values()]; // [list of {unknown cells:# mines in given list}]
}

function solve(grid, totalMines) {
  // returns the guaranteed-safe and guaranteed-mine cells as Sets of "r,c"
  const rows = grid.length, cols = grid[0].length;
  const safe = new Set(), mines = new Set();
  const unknown = new Set();

  // find all unknown cells -> set of cells that the solver should try to solve
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === UNKNOWN) unknown.add(cellKey(r, c));

  const isSubset = (a, b) => [...a].every((x) => b.has(x));

  let changed = true; // state of whether or not the solver was able to do anything
  while (changed) { // only stops repeating the solver when board cannot be further solved
    changed = false;
    const constraints = getConstraints(grid, unknown, safe, mines);

    // checking obvious flags and safes
    for (const {cells, count} of constraints) {
      if (count === 0) { // contraints fulfilled, current mine is safe
        for (const cell of cells) if (!safe.has(cell)) {safe.add(cell); changed = true;}
      } else if (count === cells.size) { // # of mines = remaining tiles -> all remaining cells are mines
        for (const cell of cells) if (!mines.has(cell)) {mines.add(cell); changed = true;}
      }
    }

    if (changed) continue;

    // if no obvious mines or safes, use subset rule to find sneaky mines and safes
    // subset rule: if a's cells are a subset of b's, the set difference (or complement) must contain b.count - a.count mines
    // https://minesweeperblast.com/patterns/subset-safe-pattern/ for more info

    for (const a of constraints) {
      for (const b of constraints) {
        if (a === b || a.cells.size >= b.cells.size || !isSubset(a.cells, b.cells)) continue;
        const diff = [...b.cells].filter((x) => !a.cells.has(x));
        const dn = b.count - a.count;
        if (dn === 0) {
          for (const cell of diff) if (!safe.has(cell)) { safe.add(cell); changed = true; }
        } else if (dn === diff.length) {
          for (const cell of diff) if (!mines.has(cell)) { mines.add(cell); changed = true; }
        }
      }
    }
  }
  return {safe, mines};
}


// i lowkey copy pasted 100% of the guessing functions from claude cause i dont know what to do when you have no more guaranteed moves left and you have to guess
function connectedComponents(constraints) {
  // groups constraints into components of cells linked (directly or transitively) by appearing together in a constraint
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const { cells } of constraints) {
    for (const cell of cells) if (!parent.has(cell)) parent.set(cell, cell);
    const first = cells.values().next().value;
    for (const cell of cells) union(first, cell);
  }

  const groups = new Map();
  for (const constraint of constraints) {
    const root = find(constraint.cells.values().next().value);
    if (!groups.has(root)) groups.set(root, { cells: new Set(), constraints: [] });
    const group = groups.get(root);
    for (const cell of constraint.cells) group.cells.add(cell);
    group.constraints.push(constraint);
  }
  return [...groups.values()];
}

function enumerateComponent(cells, constraints, cap = 25) {
  // brute-force (with pruning) every mine/safe assignment of 'cells'
  // consistent with `constraints`; null if the component exceeds the cap
  const list = [...cells].sort();
  if (list.length > cap) return null;

  const indexOf = new Map(list.map((cell, i) => [cell, i]));
  const assignment = new Array(list.length).fill(null);
  const mineCounts = new Map(list.map((cell) => [cell, 0]));
  let totalValid = 0;

  const constraintsOk = () => {
    for (const { cells: cset, count } of constraints) {
      let knownMines = 0, unresolved = 0;
      for (const c of cset) {
        const v = assignment[indexOf.get(c)];
        if (v === null) unresolved += 1;
        else if (v === 1) knownMines += 1;
      }
      if (knownMines > count || knownMines + unresolved < count) return false;
    }
    return true;
  };

  const backtrack = (i) => {
    if (i === list.length) {
      totalValid += 1;
      for (const cell of list) if (assignment[indexOf.get(cell)] === 1) mineCounts.set(cell, mineCounts.get(cell) + 1);
      return;
    }
    for (const v of [0, 1]) {
      assignment[i] = v;
      if (constraintsOk()) backtrack(i + 1);
      assignment[i] = null;
    }
  };

  backtrack(0);
  return { mineCounts, totalValid };
}

function guess(grid, totalMines, safe, mines) {
  // returns the single unknown "r,c" cell with the lowest estimated mine
  // probability; call only when solve() finds nothing
  const rows = grid.length, cols = grid[0].length;
  const unknown = new Set();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === UNKNOWN) unknown.add(cellKey(r, c));
  for (const cell of safe) unknown.delete(cell);
  for (const cell of mines) unknown.delete(cell);

  const constraints = getConstraints(grid, unknown, new Set(), mines);

  const probability = new Map();
  const constrainedCells = new Set();
  let knownMinesInComponents = 0;

  for (const group of connectedComponents(constraints)) {
    for (const cell of group.cells) constrainedCells.add(cell);
    const result = enumerateComponent(group.cells, group.constraints);

    if (result === null) {
      // component too large to enumerate: local single-constraint ratio
      for (const cell of group.cells) {
        const ratios = group.constraints
          .filter((k) => k.cells.has(cell))
          .map((k) => k.count / k.cells.size);
        probability.set(cell, ratios.reduce((s, x) => s + x, 0) / ratios.length);
      }
      continue;
    }

    const { mineCounts, totalValid } = result;
    if (totalValid === 0) continue;

    for (const cell of group.cells) {
      const p = mineCounts.get(cell) / totalValid;
      knownMinesInComponents += p;
      probability.set(cell, p);
    }
  }

  const unconstrained = [...unknown].filter((cell) => !constrainedCells.has(cell));
  if (unconstrained.length) {
    const remaining = Math.max(totalMines - mines.size - knownMinesInComponents, 0);
    const baseProb = remaining / unconstrained.length;
    for (const cell of unconstrained) probability.set(cell, baseProb);
  }

  let best = null;
  for (const [cell, p] of probability) if (best === null || p < probability.get(best)) best = cell;
  return best;
}

// vision for reading the board

const GREENS = [[170, 215, 81], [162, 209, 73]];
const TANS = [[229, 194, 159], [215, 184, 153], [236, 209, 183]];
const DIGIT_COLORS = [
  [1, [25, 118, 210]],   // blue
  [2, [56, 142, 60]],    // green
  [3, [211, 47, 47]],    // red
  [4, [123, 31, 162]],   // purple
  [5, [255, 143, 0]],    // orange
  [6, [0, 151, 167]],    // teal
  [7, [66, 66, 66]],     // dark gray
  [8, [149, 165, 166]],  // light gray
];

const MINE_LUMINANCE_THRESHOLD = 50;
const SAMPLE_OFFSETS = [-0.1, -0.05, 0, 0.05, 0.1];

const close = (a, b, tol = 30) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
const luminance = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

function classifyPixel(px) {
  for (const g of GREENS) if (close(px, g)) return "green";
  for (const t of TANS) if (close(px, t)) return "tan";
  if (luminance(px) < MINE_LUMINANCE_THRESHOLD) return "mine";
  for (const [n, color] of DIGIT_COLORS) if (close(px, color)) return n;
  return null;
}

const DIFFICULTIES = [
  { name: "easy", rows: 8, cols: 10, mines: 10 },
  { name: "medium", rows: 14, cols: 18, mines: 40 },
  { name: "hard", rows: 20, cols: 24, mines: 99 },
];

function detectDifficulty(width, height) {
  // cells are square, so the correct grid divides the canvas into equal
  // cell widths and heights; pick the difficulty minimizing the mismatch
  let best = null, bestErr = Infinity;
  for (const d of DIFFICULTIES) {
    const err = Math.abs(width / d.cols - height / d.rows);
    if (err < bestErr) { bestErr = err; best = d; }
  }
  return best;
}

function readBoard(imageData, rows, cols) {
  const { data, width, height } = imageData;
  const cellW = width / cols, cellH = height / rows;
  const px = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  const grid = Array.from({ length: rows }, () => new Array(cols).fill(UNREADABLE));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellW, cy = (r + 0.5) * cellH;
      const votes = [];
      for (const fx of SAMPLE_OFFSETS)
        for (const fy of SAMPLE_OFFSETS)
          votes.push(classifyPixel(px(Math.round(cx + fx * cellW), Math.round(cy + fy * cellH))));

      const digits = votes.filter((v) => typeof v === "number");
      if (digits.length) {
        const tally = new Map();
        for (const d of digits) tally.set(d, (tally.get(d) || 0) + 1);
        grid[r][c] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else if (votes.filter((v) => v === "mine").length > votes.length / 2) {
        grid[r][c] = MINE;
      } else if (votes.filter((v) => v === "green").length > votes.length / 2) {
        grid[r][c] = UNKNOWN;
      } else if (votes.filter((v) => v === "tan").length > votes.length / 2) {
        grid[r][c] = 0;
      }
    }
  }
  return grid;
}

// decision
function nextAction(grid, totalMines) {
  const rows = grid.length, cols = grid[0].length;
  let hasUnknown = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === MINE) return { action: "loss", cells: null };
      if (grid[r][c] === UNKNOWN) hasUnknown = true;
    }
  }
  if (!hasUnknown) return { action: "win", cells: null };

  const { safe, mines } = solve(grid, totalMines);
  if (safe.size) return { action: "click", cells: [...safe].sort().map(parseCell) };

  // solver deduced every remaining unopened cell is a mine -> win even
  // though the board still visually shows unopened cells
  let allMines = true;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === UNKNOWN && !mines.has(cellKey(r, c))) allMines = false;
  if (allMines) return { action: "win", cells: null };

  return { action: "click", cells: [parseCell(guess(grid, totalMines, safe, mines))] };
}

// clicker

const PRESS_HOLD_MS = 100; // Task 1 spike: events fired in one tick are ignored; a real down->up gap is required

async function clickCell(canvas, r, c, rows, cols) {
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + ((c + 0.5) * rect.width) / cols;
  const y = rect.top + ((r + 0.5) * rect.height) / rows;
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true };
  canvas.dispatchEvent(new PointerEvent("pointerdown", opts));
  canvas.dispatchEvent(new MouseEvent("mousedown", opts));
  await sleep(PRESS_HOLD_MS);
  canvas.dispatchEvent(new PointerEvent("pointerup", opts));
  canvas.dispatchEvent(new MouseEvent("mouseup", opts));
  canvas.dispatchEvent(new MouseEvent("click", opts));
}

// board capture

function captureBoard(canvas) {
  const off = document.createElement("canvas");
  off.width = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, off.width, off.height);
}

// main loop and solve button

const CLICK_DELAY_MS = 300;

const READ_RETRY_ATTEMPTS = 8;
const READ_RETRY_DELAY_MS = 400;
const MODAL_GRACE_ATTEMPTS = 30;
const MODAL_GRACE_DELAY_MS = 500;
const STALE_MODAL_CLEAR_ATTEMPTS = 10;
const STALE_MODAL_CLEAR_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const resultText = (outcome) => (outcome === "win" ? "won 🎉" : "lost 💥");

// 'generation' identifies the current solve run. each solveGame() call
// captures the generation it was started with; a click while a run is
// in-flight bumps `generation` without starting a new run (see
// injectButton below), so every generation check below (`gen !== generation`)
// goes stale at once and the in-flight run exits promptly instead of racing
// a freshly-started second run against the same canvas/button.

let generation = 0;

// promise for the in-flight solveGame() call, or null when idle. used to
// make sure a click never starts a second run while one is still winding
// down after a stop request.
let activeRun = null;


function detectGameOverModal() {
  const text = document.body.innerText;
  if (text.includes("Play again")) return "win";
  if (text.includes("Try again")) return "loss";
  return null;
}

async function readBoardWithRetry(canvas, rows, cols, myGeneration) {
  for (let attempt = 0; attempt < READ_RETRY_ATTEMPTS; attempt++) {
    if (myGeneration !== generation) return null; // stop requested mid-read
    const grid = readBoard(captureBoard(canvas), rows, cols);
    if (!grid.some((row) => row.includes(UNREADABLE))) return grid;
    if (detectGameOverModal()) return null; // caller re-checks via detectGameOverModal
    await sleep(READ_RETRY_DELAY_MS);
  }
  // board stayed unreadable: almost always the game-over dim with the modal
  // text still on its way. wait for the modal alone before giving up.
  for (let attempt = 0; attempt < MODAL_GRACE_ATTEMPTS; attempt++) {
    if (myGeneration !== generation) return null; // stop requested mid-read
    if (detectGameOverModal()) return null;
    await sleep(MODAL_GRACE_DELAY_MS);
  }
  if (myGeneration !== generation) return null; // stop requested during the last sleep
  throw new Error("board still unreadable after retries");
}

// live verification finding: reloading the page (the recommended way to get
// a fresh board between difficulty switches) sometimes restores the *previous*
// game's finished summary screen instead of a blank board (session-persisted
// state) the same permanently-dimmed modal state as an in-progress win/loss,
// but present before we've clicked anything. dismiss it so we start fresh
// rather than immediately reporting a stale result.
async function dismissStaleModal() {
  const status = detectGameOverModal();
  if (!status) return;
  const label = status === "win" ? "Play again" : "Try again";
  const el = [...document.querySelectorAll("button, div, span")].find((node) => node.textContent.trim() === label);
  if (el) el.click();
  // wait for the modal text to actually leave the DOM before returning:
  // a fixed sleep here can race the click's effect, and solveGame's first
  // loop iteration would then read the leftover modal as this run's result.
  for (let attempt = 0; attempt < STALE_MODAL_CLEAR_ATTEMPTS; attempt++) {
    if (!detectGameOverModal()) return;
    await sleep(STALE_MODAL_CLEAR_DELAY_MS);
  }
  if (detectGameOverModal()) throw new Error("stale game-over modal did not clear");
}

async function solveGame(button, myGeneration) {
  const canvas = document.querySelector("canvas");
  const { rows, cols, mines } = detectDifficulty(canvas.width, canvas.height);

  await dismissStaleModal();
  let grid = await readBoardWithRetry(canvas, rows, cols, myGeneration);
  if (grid && grid.every((row) => row.every((v) => v === UNKNOWN))) {
    // fresh board: first click is always safe so click at the center
    await clickCell(canvas, Math.floor(rows / 2), Math.floor(cols / 2), rows, cols);
    await sleep(CLICK_DELAY_MS);
  }

  while (myGeneration === generation) {
    const modalResult = detectGameOverModal();
    if (modalResult) {
      button.textContent = resultText(modalResult);
      return;
    }
    grid = await readBoardWithRetry(canvas, rows, cols, myGeneration);
    if (grid === null) continue; // modal appeared mid-retry or stop requested
    const { action, cells } = nextAction(grid, mines);
    if (action === "win" || action === "loss") {
      button.textContent = resultText(action);
      return;
    }
    for (const [r, c] of cells) {
      if (myGeneration !== generation) break;
      await clickCell(canvas, r, c, rows, cols);
      await sleep(CLICK_DELAY_MS);
    }
  }
  button.textContent = "stopped";
}

function injectButton() {
  const button = document.createElement("button");
  button.textContent = "▶ Solve";
  Object.assign(button.style, {
    position: "fixed", bottom: "16px", right: "16px", zIndex: "99999",
    padding: "10px 16px", background: "#4a752c", color: "white",
    border: "none", borderRadius: "6px", fontSize: "14px", cursor: "pointer",
    fontFamily: "sans-serif",
  });
  button.addEventListener("click", () => {
    if (activeRun) {
      // click while solving = stop: bump the generation so the in-flight
      // run's checks go stale and it exits on its own; don't start a new
      // run until it actually finishes (activeRun resolves to null below).
      generation++;
      return;
    }
    const myGeneration = ++generation;
    button.textContent = "solving…";
    activeRun = solveGame(button, myGeneration)
      .catch((err) => {
        console.error("[minesweeper-bot]", err);
        // if a stop click already bumped the generation, the run is stale:
        // show "stopped" (the throw skipped solveGame's own "stopped" line)
        // so the button never sticks on "solving…".
        if (myGeneration === generation) button.textContent = "error (see console)";
        else button.textContent = "stopped";
      })
      .finally(() => {
        activeRun = null;
      });
  });
  document.body.appendChild(button);
}

if (typeof document !== "undefined") {
  // the game canvas may not exist yet (or appears after opening the game
  // from a search results page); poll until it does
  const poll = setInterval(() => {
    if (document.querySelector("canvas")) {
      clearInterval(poll);
      injectButton();
    }
  }, 1000);
}

// node export for port-time verification (node test_userscript.js)

if (typeof module !== "undefined") {
  module.exports = {
    UNKNOWN, UNREADABLE, MINE, cellKey, parseCell, solve, guess,
    nextAction, classifyPixel, detectDifficulty, readBoard,
  };
}
