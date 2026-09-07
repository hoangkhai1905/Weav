'use strict';

class MinHeap {
  constructor() {
    this.heap = [];
  }

  push(val) {
    this.heap.push(val);
    this._up(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._down(0);
    }
    return top;
  }

  get size() {
    return this.heap.length;
  }

  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[i] < this.heap[p]) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[p];
        this.heap[p] = tmp;
        i = p;
      } else {
        break;
      }
    }
  }

  _down(i) {
    const len = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < len && this.heap[left] < this.heap[smallest]) {
        smallest = left;
      }
      if (right < len && this.heap[right] < this.heap[smallest]) {
        smallest = right;
      }

      if (smallest !== i) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[smallest];
        this.heap[smallest] = tmp;
        i = smallest;
      } else {
        break;
      }
    }
  }
}

/**
 * Topologically sorts task IDs while picking the lexicographically smallest
 * available task at each step.
 *
 * @param {Array<{ id: string, dependsOn: string[] }>} tasks
 * @returns {string[]}
 */
function orderTasks(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error('Input tasks must be an array');
  }

  const allIds = new Set();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string') {
      throw new Error('Each task must have a valid string id');
    }
    if (allIds.has(task.id)) {
      throw new Error(`Duplicate task id detected: ${task.id}`);
    }
    allIds.add(task.id);
  }

  const inDegree = new Map();
  const dependents = new Map();

  for (const id of allIds) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const task of tasks) {
    const deps = task.dependsOn || [];
    if (!Array.isArray(deps)) {
      throw new Error(`Task ${task.id} dependsOn must be an array`);
    }

    const uniqueDeps = new Set();
    for (const dep of deps) {
      if (typeof dep !== 'string' || !allIds.has(dep)) {
        throw new Error(`Unknown dependency: ${dep}`);
      }
      uniqueDeps.add(dep);
    }

    inDegree.set(task.id, uniqueDeps.size);
    for (const dep of uniqueDeps) {
      dependents.get(dep).push(task.id);
    }
  }

  const available = new MinHeap();
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      available.push(id);
    }
  }

  const result = [];
  while (available.size > 0) {
    const current = available.pop();
    result.push(current);

    const nextTasks = dependents.get(current) || [];
    for (const nextId of nextTasks) {
      const remaining = inDegree.get(nextId) - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0) {
        available.push(nextId);
      }
    }
  }

  if (result.length < tasks.length) {
    throw new Error('Cycle detected in task dependencies');
  }

  return result;
}

module.exports = {
  orderTasks,
};
