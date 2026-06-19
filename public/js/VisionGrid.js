/**
 * VisionGrid.js — 二维视野数组，标记每个格子是否对某玩家可见
 */
export class VisionGrid {
  constructor(gridSize) {
    this.gridSize = gridSize;
    this.grid = this._empty();
  }

  _empty() {
    return Array.from({ length: this.gridSize }, () =>
      Array(this.gridSize).fill(false)
    );
  }

  reset() {
    this.grid = this._empty();
  }

  set(x, y, visible = true) {
    if (this.inBounds(x, y)) this.grid[y][x] = visible;
  }

  get(x, y) {
    if (!this.inBounds(x, y)) return false;
    return this.grid[y][x];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.gridSize && y < this.gridSize;
  }

  revealCircle(cx, cy, r) {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r2) {
          this.set(cx + dx, cy + dy, true);
        }
      }
    }
  }

  static fromArray(gridSize, arr) {
    const v = new VisionGrid(gridSize);
    if (!arr?.length) return v;
    if (!Array.isArray(arr[0])) {
      for (let i = 0; i + 1 < arr.length; i += 2) {
        v.set(arr[i], arr[i + 1]);
      }
      return v;
    }
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        v.grid[y][x] = !!arr[y]?.[x];
      }
    }
    return v;
  }

  toArray() {
    return this.grid.map(row => [...row]);
  }

  visibleCount() {
    let n = 0;
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (this.grid[y][x]) n++;
      }
    }
    return n;
  }

  boundingRadius(cx, cy) {
    let maxR = 0;
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (this.grid[y][x]) {
          maxR = Math.max(maxR, Math.hypot(x - cx, y - cy));
        }
      }
    }
    return maxR;
  }
}
