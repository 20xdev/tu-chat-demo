// Synthetic public configuration, not AWS/Cognito production settings.
const config = {
  authorizationEndpoint: 'https://login.example.invalid/oauth2/authorize',
  tokenEndpoint: 'https://login.example.invalid/oauth2/token',
  logoutEndpoint: 'https://login.example.invalid/logout',
  clientId: 'synthetic-public-client',
  redirectUri: 'https://chat-style-lab.example.invalid',
  scope: 'email openid profile',
  agentEndpoint: 'https://frontdoor.example.invalid/runtimes/arn%3Aaws%3Afixture%2Fruntime/invocations?qualifier=DEFAULT',
  responseType: 'code',
  codeChallengeMethod: 'S256',
  protocol: 'ag-ui',
};
module.exports = {
  config,
  sheet: {
    total: 10,
    limit: 10,
    offset: 0,
    data: Object.entries(config).map(([key, value]) => ({ key, value })),
    ':type': 'sheet',
  },
};
