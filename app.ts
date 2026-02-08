'use strict';

import Homey from 'homey';
import { MyQClient } from './lib/MyQClient';

class MyApp extends Homey.App {

  public myqClient!: MyQClient;

  async onInit() {
    this.myqClient = new MyQClient(this.homey);
    await this.myqClient.init();

    this._registerFlowCards();
    this._listenForSettings();

    this.log('Liftmaster myQ app initialized');
  }

  private _listenForSettings(): void {
    this.homey.settings.on('set', (key: string) => {
      if (key === 'myq_refresh_token_input') {
        this._handleNewRefreshToken().catch((err) => {
          this.error('Failed to handle refresh token:', err.message);
        });
      }
    });
  }

  private async _handleNewRefreshToken(): Promise<void> {
    const refreshToken = this.homey.settings.get('myq_refresh_token_input') as string | null;
    if (!refreshToken) return;

    try {
      await this.myqClient.setRefreshToken(refreshToken.trim());
      // Clear the input setting (token is now stored internally)
      this.homey.settings.unset('myq_refresh_token_input');
      this.log('myQ refresh token successfully configured');
      this.homey.api.realtime('myq_status', { configured: true, error: null });
    } catch (err: any) {
      this.error('Failed to configure myQ token:', err.message);
      this.homey.api.realtime('myq_status', { configured: false, error: err.message });
    }
  }

  private _registerFlowCards(): void {
    // Door/gate action cards
    this.homey.flow.getActionCard('open_door').registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('garagedoor_closed', false);
    });

    this.homey.flow.getActionCard('close_door').registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('garagedoor_closed', true);
    });

    // Door/gate condition cards
    this.homey.flow.getConditionCard('is_open').registerRunListener(async (args) => {
      return args.device.getCapabilityValue('garagedoor_closed') === false;
    });

    this.homey.flow.getConditionCard('is_closed').registerRunListener(async (args) => {
      return args.device.getCapabilityValue('garagedoor_closed') === true;
    });

    // Lamp action cards
    this.homey.flow.getActionCard('turn_on_lamp').registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff', true);
    });

    this.homey.flow.getActionCard('turn_off_lamp').registerRunListener(async (args) => {
      await args.device.triggerCapabilityListener('onoff', false);
    });
  }

}

module.exports = MyApp;
