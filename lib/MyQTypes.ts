'use strict';

// Token response from POST /connect/token
export interface MyQTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// Persisted token state (stored in Homey settings)
export interface MyQTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Date.now() + (expires_in * 1000) - margin
}

// Account from GET /api/v6.0/accounts
export interface MyQAccount {
  id: string;
  name: string;
}

export interface MyQAccountsResponse {
  items: MyQAccount[];
}

// Device state fields
export interface MyQDeviceState {
  door_state?: string;
  lamp_state?: string;
  online?: boolean;
  last_update?: string;
  [key: string]: unknown;
}

// Device from GET /api/v5.2/Accounts/{id}/Devices
export interface MyQDevice {
  serial_number: string;
  device_family: 'garagedoor' | 'lamp' | 'gateway';
  name: string;
  state: MyQDeviceState;
  device_type?: string;
  parent_device_id?: string;
  account_id?: string;
}

export interface MyQDevicesResponse {
  items: MyQDevice[];
}

// Homey device data object (stored permanently per paired device)
export interface MyQDeviceData {
  id: string; // serial_number
  accountId: string;
}

// Door commands
export type DoorCommand = 'open' | 'close';

// Lamp commands
export type LampCommand = 'on' | 'off';

// Door state enum
export enum DoorState {
  Open = 'open',
  Closed = 'closed',
  Opening = 'opening',
  Closing = 'closing',
  Stopped = 'stopped',
  Unknown = 'unknown',
}
