import {
  isInvitationRequest,
  isTemplateRequest,
} from './gateway-throttler.guard';

describe('isTemplateRequest', () => {
  const ws = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa7';

  it.each([
    ['POST', `/api/v1/templates/${id}/use`],
    ['PATCH', `/api/v1/templates/${id}`],
    ['DELETE', `/api/v1/templates/${id}`],
    ['PUT', `/api/v1/workspaces/${ws}/workflows/${id}/template`],
    ['POST', `/api/v1/workspaces/${ws}/workflows/${id}/template/preview`],
    ['GET', '/api/v1/templates/by-code/WV7K3M9Q'],
    ['POST', `/api/v1/templates/${id}/use?x=1`],
  ])('limits %s %s', (method, url) => {
    expect(isTemplateRequest({ method, url })).toBe(true);
  });

  it.each([
    ['GET', '/api/v1/templates?scope=public'],
    ['GET', `/api/v1/templates/${id}`],
    ['GET', `/api/v1/workspaces/${ws}/workflows/${id}`],
    ['PUT', `/api/v1/workspaces/${ws}/workflows/${id}/draft`],
    ['OPTIONS', `/api/v1/templates/${id}/use`],
    ['POST', '/api/v1/other/templates'],
  ])('does not limit %s %s', (method, url) => {
    expect(isTemplateRequest({ method, url })).toBe(false);
  });
});

describe('isInvitationRequest', () => {
  const ws = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa7';

  it.each([
    ['POST', `/api/v1/workspaces/${ws}/invitations`],
    ['POST', `/api/v1/workspaces/${ws}/invitations/${id}/resend`],
    ['POST', `/api/v1/workspaces/${ws}/invitations?x=1`],
  ])('limits %s %s', (method, url) => {
    expect(isInvitationRequest({ method, url })).toBe(true);
  });

  it.each([
    ['GET', `/api/v1/workspaces/${ws}/invitations`],
    ['DELETE', `/api/v1/workspaces/${ws}/invitations/${id}`],
    ['POST', `/api/v1/invitations/${id}/accept`],
    ['POST', `/api/v1/workspaces/${ws}/members`],
  ])('does not limit %s %s', (method, url) => {
    expect(isInvitationRequest({ method, url })).toBe(false);
  });
});
