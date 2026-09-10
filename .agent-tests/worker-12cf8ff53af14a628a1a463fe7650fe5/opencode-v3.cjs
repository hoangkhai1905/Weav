"use strict";

/**
 * Topological sort with lexicographic tie-breaking.
 *
 * @param {Array<{id: string, dependsOn: string[]}>} tasks
 * @returns {string[]} Ordered task IDs
 * @throws {Error} On duplicate IDs, unknown dependencies, or cycles
 */
function orderTasks(tasks) {
  if (!Array.isArray(tasks)) {
    throw new TypeError("orderTasks expects an array of task objects");
  }

  const idSet = new Set();
  const inDeg = new Map();
  const adj = new Map();

  for (const t of tasks) {
    if (!t || typeof t.id !== "string" || !Array.isArray(t.dependsOn)) {
      throw new TypeError("Each task must have {id: string, dependsOn: string[]}");
    }
    if (idSet.has(t.id)) {
      throw new Error("Duplicate id: " + t.id);
    }
    idSet.add(t.id);
    inDeg.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!idSet.has(dep)) {
        throw new Error("Unknown dependency '" + dep + "' for task '" + t.id + "'");
      }
      adj.get(dep).push(t.id);
      inDeg.set(t.id, inDeg.get(t.id) + 1);
    }
  }

  const queue = [];
  for (const id of idSet) {
    if (inDeg.get(id) === 0) {
      queue.push(id);
    }
  }
  queue.sort();

  const result = [];

  while (queue.length > 0) {
    const id = queue.shift();
    result.push(id);
    for (const next of adj.get(id)) {
      inDeg.set(next, inDeg.get(next) - 1);
      if (inDeg.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  if (result.length !== idSet.size) {
    throw new Error("Cycle detected among tasks");
  }

  return result;
}

module.exports = { orderTasks };
