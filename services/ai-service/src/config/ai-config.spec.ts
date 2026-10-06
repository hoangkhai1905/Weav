import { loadAiConfig, missingAssistantDbVars } from './ai-config';

describe('missingAssistantDbVars', () => {
  it('names every unset DB variable and never a value', () => {
    const config = loadAiConfig({ DB_HOST: 'h', DB_PASSWORD: 'secret-pw' });
    const missing = missingAssistantDbVars(config);
    expect(missing).toEqual(['DB_NAME', 'DB_USERNAME']);
    expect(JSON.stringify(missing)).not.toContain('secret-pw');
  });

  it('is empty when all four are set, and treats blanks as unset', () => {
    const all = {
      DB_HOST: 'h',
      DB_NAME: 'n',
      DB_USERNAME: 'u',
      DB_PASSWORD: 'p',
    };
    expect(missingAssistantDbVars(loadAiConfig(all))).toEqual([]);
    expect(
      missingAssistantDbVars(loadAiConfig({ ...all, DB_HOST: '' })),
    ).toEqual(['DB_HOST']);
  });
});
