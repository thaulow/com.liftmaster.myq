'use strict';

import Homey from 'homey';
import { MyQClient } from './MyQClient';
import { MyQDeviceData, DoorState } from './MyQTypes';

const POLL_INTERVAL_DEFAULT = 30_000; // 30 seconds
const POLL_INTERVAL_ACTIVE = 5_000; // 5 seconds after command
const POLL_ACTIVE_DURATION = 60_000; // fast-poll for 60 seconds

/**
 * Shared base class for gate and garage door devices.
 * Both device types use the same myQ API and capabilities.
 */
export class MyQDoorDevice extends Homey.Device {

  private _pollInterval: ReturnType<typeof setInterval> | null = null;
  private _activePollTimeout: ReturnType<typeof setTimeout> | null = null;

  async onInit() {
    this.log(`${this.constructor.name} initialized:`, this.getName());

    this.registerCapabilityListener('garagedoor_closed', this._onCapabilityGaragedoorClosed.bind(this));

    this._startPolling(POLL_INTERVAL_DEFAULT);

    // Immediate first poll
    await this._poll().catch((err) => this.error('Initial poll failed:', err.message));
  }

  async onUninit() {
    this._stopPolling();
  }

  private _getClient(): MyQClient {
    return (this.homey.app as any).myqClient;
  }

  private _getDeviceData(): MyQDeviceData {
    return this.getData() as MyQDeviceData;
  }

  // --- Capability handler ---

  private async _onCapabilityGaragedoorClosed(value: boolean): Promise<void> {
    const client = this._getClient();
    const { id: serialNumber } = this._getDeviceData();
    const command = value ? 'close' : 'open';

    this.log(`Sending ${command} command to ${serialNumber}`);

    try {
      await client.sendDoorCommand(serialNumber, command);
      this._startActivePoll();
    } catch (err: any) {
      this.error(`Failed to send ${command}:`, err.message);
      throw new Error(this.homey.__('errors.command_failed'));
    }
  }

  // --- Polling ---

  private _startPolling(interval: number): void {
    this._stopPolling();
    this._pollInterval = this.homey.setInterval(() => {
      this._poll().catch((err) => this.error('Poll error:', err.message));
    }, interval);
  }

  private _stopPolling(): void {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._activePollTimeout) {
      this.homey.clearTimeout(this._activePollTimeout);
      this._activePollTimeout = null;
    }
  }

  private _startActivePoll(): void {
    // Switch to fast polling
    this._startPolling(POLL_INTERVAL_ACTIVE);

    // After POLL_ACTIVE_DURATION, revert to default
    if (this._activePollTimeout) {
      this.homey.clearTimeout(this._activePollTimeout);
    }
    this._activePollTimeout = this.homey.setTimeout(() => {
      this._startPolling(POLL_INTERVAL_DEFAULT);
      this._activePollTimeout = null;
    }, POLL_ACTIVE_DURATION);
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

    // Mark available if previously unavailable
    if (!this.getAvailable()) {
      await this.setAvailable();
    }

    // Update capabilities
    const doorState = (device.state.door_state as string) || 'unknown';
    const isClosed = doorState === DoorState.Closed;

    await this.setCapabilityValue('garagedoor_closed', isClosed).catch(this.error);

    if (this.hasCapability('gate_state')) {
      await this.setCapabilityValue('gate_state', doorState).catch(this.error);
    }

  }

}
