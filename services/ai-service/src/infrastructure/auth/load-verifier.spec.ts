import { loadVerifier } from './load-verifier';

describe('loadVerifier', () => {
  it('logs error class and path (no contents) and returns null when the JWKS cannot load', () => {
    const logger = { error: jest.fn() };
    expect(loadVerifier('/does/not/exist.json', logger)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith({
      msg: 'JWKS load failed',
      errorClass: 'Error',
      file: '/does/not/exist.json',
    });
  });
});
