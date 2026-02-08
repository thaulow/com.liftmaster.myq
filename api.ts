'use strict';

module.exports = {
  async getStatus({ homey }: { homey: any }): Promise<{ configured: boolean }> {
    const app = homey.app as any;
    return {
      configured: app.myqClient?.isConfigured() ?? false,
    };
  },
};
