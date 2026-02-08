'use strict';

import https from 'https';
import { URL, URLSearchParams } from 'url';
import {
  MyQTokenResponse,
  MyQTokenState,
  MyQAccount,
  MyQAccountsResponse,
  MyQDevice,
  MyQDevicesResponse,
  DoorCommand,
  LampCommand,
} from './MyQTypes';

// API Endpoints
const TOKEN_URL = 'https://partner-identity.myq-cloud.com/connect/token';
const ACCOUNTS_URL = 'https://accounts.myq-cloud.com/api/v6.0/accounts';
const DEVICES_URL = 'https://devices.myq-cloud.com/api/v5.2/Accounts/{accountId}/Devices';
const DOOR_CMD_URL = 'https://account-devices-gdo.myq-cloud.com/api/v5.2/Accounts/{accountId}/door_openers/{serialNumber}/{command}';
const LAMP_CMD_URL = 'https://account-devices-lamp.myq-cloud.com/api/v5.2/Accounts/{accountId}/lamps/{serialNumber}/{command}';

// OAuth Constants
const CLIENT_ID = 'ANDROID_CGI_MYQ';
const CLIENT_SECRET = 'UD4DXnKyPWq25BSw';
const REDIRECT_URI = 'com.myqops://android';
const SCOPE = 'MyQ_Residential offline_access';

// API Headers
const APP_ID = 'D9D7B25035D549D8A3EA16A9FFB8C927D4A19B55B8944011B2670A8321BF8312';
const APP_VERSION = '5.242.0.72704';
const USER_AGENT = 'sdk_gphone_x86/Android 11';
const BRAND_ID = '1';

// Settings Keys
const SETTINGS_TOKEN_STATE = 'myq_token_state';
const SETTINGS_ACCOUNT_ID = 'myq_account_id';

// Timing
const TOKEN_REFRESH_MARGIN_MS = 3 * 60 * 1000; // refresh 3 min before expiry
const RATE_LIMIT_DURATION_MS = 90 * 60 * 1000; // 90 min lockout on 429

export class MyQClient {

  private homey: any;
  private _tokenState: MyQTokenState | null = null;
  private _accountId: string | null = null;
  private _rateLimitedUntil: number = 0;
  private _refreshPromise: Promise<void> | null = null;

  constructor(homey: any) {
    this.homey = homey;
  }

  /**
   * Initialize from persisted state.
   */
  async init(): Promise<void> {
    const stored = this.homey.settings.get(SETTINGS_TOKEN_STATE) as MyQTokenState | null;
    if (stored) {
      this._tokenState = stored;
    }
    this._accountId = this.homey.settings.get(SETTINGS_ACCOUNT_ID) as string | null;
  }

  /**
   * Whether the client has a refresh token configured.
   */
  isConfigured(): boolean {
    return this._tokenState !== null && !!this._tokenState.refreshToken;
  }

  /**
   * Set a new refresh token (from the settings page).
   * Performs initial token exchange and fetches account ID.
   */
  async setRefreshToken(refreshToken: string): Promise<void> {
    // Store a temporary state with just the refresh token
    this._tokenState = {
      accessToken: '',
      refreshToken,
      expiresAt: 0,
    };

    // Exchange for access token
    await this._refreshAccessToken();

    // Fetch and cache account ID
    await this._fetchAccountId();
  }

  /**
   * Get the account ID (fetches if not cached).
   */
  async getAccountId(): Promise<string> {
    if (this._accountId) {
      return this._accountId;
    }
    return this._fetchAccountId();
  }

  /**
   * Get all accounts.
   */
  async getAccounts(): Promise<MyQAccount[]> {
    const response = await this._authenticatedGet<MyQAccountsResponse>(ACCOUNTS_URL);
    return response.items || [];
  }

  /**
   * Get all devices across all accounts.
   */
  async getDevices(): Promise<MyQDevice[]> {
    const accountId = await this.getAccountId();
    const url = DEVICES_URL.replace('{accountId}', accountId);
    const response = await this._authenticatedGet<MyQDevicesResponse>(url);
    return response.items || [];
  }

  /**
   * Get a single device by serial number.
   */
  async getDevice(serialNumber: string): Promise<MyQDevice | undefined> {
    const devices = await this.getDevices();
    return devices.find((d) => d.serial_number === serialNumber);
  }

  /**
   * Send a command to a door/gate device.
   */
  async sendDoorCommand(serialNumber: string, command: DoorCommand): Promise<void> {
    const accountId = await this.getAccountId();
    const url = DOOR_CMD_URL
      .replace('{accountId}', accountId)
      .replace('{serialNumber}', serialNumber)
      .replace('{command}', command);
    await this._authenticatedPut(url);
  }

  /**
   * Send a command to a lamp device.
   */
  async sendLampCommand(serialNumber: string, command: LampCommand): Promise<void> {
    const accountId = await this.getAccountId();
    const url = LAMP_CMD_URL
      .replace('{accountId}', accountId)
      .replace('{serialNumber}', serialNumber)
      .replace('{command}', command);
    await this._authenticatedPut(url);
  }

  // --- Private: Token management ---

  private async _refreshAccessToken(): Promise<void> {
    // Coalesce concurrent refresh requests
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._doRefreshAccessToken();
    try {
      await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  private async _doRefreshAccessToken(): Promise<void> {
    if (!this._tokenState?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this._tokenState.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    }).toString();

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    };

    const response = await this._request<MyQTokenResponse>('POST', TOKEN_URL, headers, body);

    // Persist the new token state
    this._tokenState = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + (response.expires_in * 1000) - TOKEN_REFRESH_MARGIN_MS,
    };

    this.homey.settings.set(SETTINGS_TOKEN_STATE, this._tokenState);
  }

  private async _ensureAccessToken(): Promise<string> {
    if (!this._tokenState?.refreshToken) {
      throw new Error('myQ is not configured. Please set your refresh token in app settings.');
    }

    // Check rate limit
    if (this._rateLimitedUntil > Date.now()) {
      const minutes = Math.ceil((this._rateLimitedUntil - Date.now()) / 60000);
      throw new Error(`Rate limited by myQ. Please wait ~${minutes} minutes.`);
    }

    // Refresh if expired or about to expire
    if (!this._tokenState.accessToken || Date.now() >= this._tokenState.expiresAt) {
      await this._refreshAccessToken();
    }

    return this._tokenState!.accessToken;
  }

  private async _fetchAccountId(): Promise<string> {
    const accounts = await this.getAccounts();
    if (accounts.length === 0) {
      throw new Error('No myQ accounts found');
    }

    this._accountId = accounts[0].id;
    this.homey.settings.set(SETTINGS_ACCOUNT_ID, this._accountId);
    return this._accountId;
  }

  // --- Private: HTTP helpers ---

  private _getAuthHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      MyQApplicationId: APP_ID,
      'App-Version': APP_VERSION,
      BrandId: BRAND_ID,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    };
  }

  private async _authenticatedGet<T>(url: string): Promise<T> {
    const accessToken = await this._ensureAccessToken();
    const headers = this._getAuthHeaders(accessToken);

    try {
      return await this._request<T>('GET', url, headers);
    } catch (err: any) {
      // On 401, try refreshing token once and retry
      if (err.statusCode === 401) {
        await this._refreshAccessToken();
        const newToken = this._tokenState!.accessToken;
        const newHeaders = this._getAuthHeaders(newToken);
        return this._request<T>('GET', url, newHeaders);
      }
      throw err;
    }
  }

  private async _authenticatedPut(url: string): Promise<void> {
    const accessToken = await this._ensureAccessToken();
    const headers = this._getAuthHeaders(accessToken);

    try {
      await this._request<Record<string, unknown>>('PUT', url, headers);
    } catch (err: any) {
      if (err.statusCode === 401) {
        await this._refreshAccessToken();
        const newToken = this._tokenState!.accessToken;
        const newHeaders = this._getAuthHeaders(newToken);
        await this._request<Record<string, unknown>>('PUT', url, newHeaders);
        return;
      }
      throw err;
    }
  }

  private _request<T>(method: string, urlStr: string, headers: Record<string, string>, body?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 429) {
            this._rateLimitedUntil = Date.now() + RATE_LIMIT_DURATION_MS;
            const err = new Error('Rate limited by myQ API. Please wait 60-90 minutes.') as any;
            err.statusCode = 429;
            reject(err);
            return;
          }
          if (res.statusCode === 403) {
            const err = new Error('Device is offline or access denied.') as any;
            err.statusCode = 403;
            reject(err);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(`myQ API error: HTTP ${res.statusCode} - ${data.substring(0, 200)}`) as any;
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }

          try {
            resolve(data ? JSON.parse(data) as T : {} as T);
          } catch {
            resolve({} as T);
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Network error: ${err.message}`));
      });

      // 30 second timeout
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

}
