import { AuthUserService } from './auth-user.service';

describe('saved tenant branding on profile reload', () => {
  it('returns the authenticated tenant logo and title', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{
      id: 'member', tenant_id: 'workspace', tenant_name: 'Example',
      site_title: 'Example recruitment', logo_url: 'data:image/png;base64,example',
    }] });
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    const profile = await service.getProfile('member');
    expect(profile.tenant).toEqual(expect.objectContaining({
      siteTitle: 'Example recruitment', logoUrl: 'data:image/png;base64,example',
    }));
    expect(query.mock.calls[0][0]).toContain('t.site_title, t.logo_url');
    expect(query.mock.calls[0][1]).toEqual(['member']);
  });
});
