'use strict';

import Homey from 'homey';
import { MyQClient } from './lib/MyQClient';

class MyApp extends Homey.App {

  public myqClient!: MyQClient;

  async onInit() {
    this.myqClient = new MyQClient(this.homey);
    await this.myqClient.init();

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
      this.homey.settings.set('myq_configured', true);
      this.homey.settings.set('myq_error', '');
      this.log('myQ refresh token successfully configured');
    } catch (err: any) {
      this.error('Failed to configure myQ token:', err.message);
      this.homey.settings.set('myq_configured', false);
      this.homey.settings.set('myq_error', err.message);
    }
  }

}

module.exports = MyApp;
