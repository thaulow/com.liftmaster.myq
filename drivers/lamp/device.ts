'use strict';

import Homey from 'homey';
import { MyQClient } from '../../lib/MyQClient';
import { MyQDeviceData } from '../../lib/MyQTypes';

const POLL_INTERVAL = 30_000; // 30 seconds

class LampDevice extends Homey.Device {

  private _pollInterval: ReturnType<typeof setInterval> | null = null;

  async onInit() {
    this.log('LampDevice initialized:', this.getName());

    this.registerCapabilityListener('onoff', this._onCapabilityOnOff.bind(this));

    this._pollInterval = this.homey.setInterval(() => {
      this._poll().catch((err) => this.error('Poll error:', err.message));
    }, POLL_INTERVAL);

    // Immediate first poll
    await this._poll().catch((err) => this.error('Initial poll failed:', err.message));
  }

  async onUninit() {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  private _getClient(): MyQClient {
    return (this.homey.app as any).myqClient;
  }

  private _getDeviceData(): MyQDeviceData {
    return this.getData() as MyQDeviceData;
  }

  private async _onCapabilityOnOff(value: boolean): Promise<void> {
    const client = this._getClient();
    const { id: serialNumber } = this._getDeviceData();
    const command = value ? 'on' : 'off';

    this.log(`Sending ${command} command to lamp ${serialNumber}`);

    try {
      await client.sendLampCommand(serialNumber, command);
    } catch (err: any) {
      this.error(`Failed to send ${command}:`, err.message);
      throw new Error(this.homey.__('errors.command_failed'));
    }
  }

  private async _poll(): Promise<void> {
    const client = this._getClient();
    if (!client || !client.isConfigured()) {
      await this.setUnavailable(this.homey.__('errors.not_configured'));
      return;
    }

    const { id: serialNumber } = this._getDeviceData();
    const device = await client.getDevice(serialNumber);

    if (!device) {
      await this.setUnavailable(this.homey.__('errors.device_not_found'));
      return;
    }

    if (device.state.online === false) {
      await this.setUnavailable(this.homey.__('errors.device_offline'));
      return;
    }

    if (!this.getAvailable()) {
      await this.setAvailable();
    }

    const isOn = device.state.lamp_state === 'on';
    await this.setCapabilityValue('onoff', isOn).catch(this.error);

  }

}

module.exports = LampDevice;
