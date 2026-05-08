import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface OpenMeteoData {
  rainfall: number;
  heatIndex: number;
  temp: number;
  humidity: number;
  forecast7day: { day: string; tempMax: number; tempMin: number; precipSum: number }[];
}

export async function fetchWeather(lat: number, lng: number): Promise<OpenMeteoData> {
  try {
    const url = `${config.openmeteo.base}/forecast`;
    const resp = await axios.get(url, {
      params: {
        latitude: lat,
        longitude: lng,
        current: 'precipitation,temperature_2m,relative_humidity_2m',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
        timezone: 'Asia/Manila',
        forecast_days: 7,
      },
      timeout: 10000,
    });

    const current = resp.data.current as Record<string, number>;
    const daily = resp.data.daily as Record<string, unknown[]>;

    const temp = current['temperature_2m'] ?? 32;
    const humidity = current['relative_humidity_2m'] ?? 70;
    const rainfall = current['precipitation'] ?? 0;
    const heatIndex = computeHeatIndex(temp, humidity);

    const forecast7day = ((daily['time'] as string[]) ?? []).map((day, i) => ({
      day,
      tempMax: (daily['temperature_2m_max'] as number[])[i] ?? temp,
      tempMin: (daily['temperature_2m_min'] as number[])[i] ?? temp - 5,
      precipSum: (daily['precipitation_sum'] as number[])[i] ?? 0,
    }));

    return { rainfall, heatIndex, temp, humidity, forecast7day };
  } catch (err) {
    logger.warn('Open-Meteo fetch failed, returning defaults', err);
    return {
      rainfall: 0,
      heatIndex: 32,
      temp: 30,
      humidity: 70,
      forecast7day: [],
    };
  }
}

function computeHeatIndex(tempC: number, humidity: number): number {
  const T = tempC * 9 / 5 + 32;
  const RH = humidity;
  const HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    0.00683783 * T * T -
    0.05481717 * RH * RH +
    0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH -
    0.00000199 * T * T * RH * RH;
  return Math.round(((HI - 32) * 5) / 9);
}
