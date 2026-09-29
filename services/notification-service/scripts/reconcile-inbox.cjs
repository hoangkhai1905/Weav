#!/usr/bin/env node

const usage =
  'Usage: node scripts/reconcile-inbox.cjs --apply [--batch-size N]';

function parseArguments(args) {
  let apply = false;
  let batchSize = 100;
  let sawBatchSize = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--apply' && !apply) {
      apply = true;
      continue;
    }
    if (args[index] === '--batch-size' && !sawBatchSize) {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value))
        throw new Error(
          `${usage}\n--batch-size must be an integer from 1 to 1000`,
        );
      batchSize = Number(value);
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
        throw new Error(
          `${usage}\n--batch-size must be an integer from 1 to 1000`,
        );
      sawBatchSize = true;
      index++;
      continue;
    }
    throw new Error(usage);
  }
  if (!apply) throw new Error(usage);
  return { batchSize };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  let repository;
  let failed = false;
  try {
    const { loadSettings } = require('../dist/config/settings');
    const {
      PrismaInboxRepository,
    } = require('../dist/infrastructure/prisma.inbox.repository');
    repository = new PrismaInboxRepository(loadSettings());
    const counts = await repository.reconcileLegacy(options.batchSize);
    process.stdout.write(`${JSON.stringify(counts)}\n`);
  } catch {
    failed = true;
  } finally {
    if (repository) {
      try {
        await repository.onModuleDestroy();
      } catch {
        failed = true;
      }
    }
  }
  if (failed) {
    process.stderr.write('Inbox reconciliation failed.\n');
    process.exitCode = 1;
  }
}

void main();
