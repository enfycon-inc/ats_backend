import { AuthInitService } from './auth-init.service';

describe('Production replica initialization', () => {
  const previous = process.env.ATS_SKIP_BOOTSTRAP;
  afterEach(() => {
    if (previous === undefined) delete process.env.ATS_SKIP_BOOTSTRAP;
    else process.env.ATS_SKIP_BOOTSTRAP = previous;
  });

  it('does not query or seed the shared database or provision Keycloak users', async () => {
    process.env.ATS_SKIP_BOOTSTRAP = 'true';
    const query = jest.fn();
    const provision = jest.fn();
    const service = new AuthInitService({ query } as any, {} as any, {
      provisionUserInKeycloak: provision,
    } as any);
    await service.onModuleInit();
    expect(query).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });
});
