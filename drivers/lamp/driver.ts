'use strict';

import Homey from 'homey';

class LampDriver extends Homey.Driver {

  async onInit() {
    this.log('LampDriver initialized');
  }

  async onPairListDevices() {
    const app = this.homey.app as any;
    const client = app.myqClient;

    if (!client || !client.isConfigured()) {
      throw new Error('myQ is not configured. Please set your refresh token in the app settings first.');
    }

    const devices = await client.getDevices();
    const accountId = await client.getAccountId();

    return devices
      .filter((d: any) => d.device_family === 'lamp')
      .map((d: any) => ({
        name: d.name || `Lamp ${d.serial_number}`,
        data: {
          id: d.serial_number,
          accountId,
        },
      }));
  }

}

module.exports = LampDriver;
