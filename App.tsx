import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

// Matches the sgv.json reading object emitted by Juggluco/xDrip (§5 of AGENTS.md).
// direction: Juggluco emits e.g. "Flat", "raised 10" etc.; NS standard uses "Flat", "SingleUp", …
interface GlucoseReading {
  sgv: number;
  date: number; // epoch ms — the only reliable staleness signal
  dateString: string;
  delta: number;
  direction: string;
  noise: number;
  _id: string;
}

type FetchStatus = 'loading' | 'ok' | 'no-data' | 'error';

const CGM_URL = 'http://127.0.0.1:17580/sgv.json?count=1';
const POLL_INTERVAL_MS = 30_000;

export default function App() {
  const [reading, setReading] = useState<GlucoseReading | null>(null);
  const [status, setStatus] = useState<FetchStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function fetchReading() {
    try {
      const response = await fetch(CGM_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        setReading(null);
        setStatus('no-data');
        return;
      }
      setReading(data[0] as GlucoseReading);
      setStatus('ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setStatus('error');
    }
  }

  useEffect(() => {
    fetchReading();
    const timer = setInterval(fetchReading, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>CGM Spike — Juggluco</Text>

      {status === 'loading' && (
        <ActivityIndicator size="large" color="#333" />
      )}

      {status === 'ok' && reading !== null && (
        <>
          <Text style={styles.glucose}>{reading.sgv}</Text>
          <Text style={styles.unit}>mg/dL</Text>
          <Text style={styles.detail}>Trend: {reading.direction}</Text>
          <Text style={styles.detail}>{reading.dateString}</Text>
        </>
      )}

      {status === 'no-data' && (
        <Text style={styles.message}>No recent CGM data from Juggluco.</Text>
      )}

      {status === 'error' && (
        <>
          <Text style={styles.error}>Failed to reach Juggluco</Text>
          <Text style={styles.errorDetail}>{errorMessage}</Text>
          <Text style={styles.hint}>
            If this URL works in the phone browser but not here, check that
            usesCleartextTraffic is enabled in app.json and rebuild the dev
            client.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    fontSize: 14,
    color: '#999',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  glucose: {
    fontSize: 96,
    fontWeight: 'bold',
    color: '#111',
  },
  unit: {
    fontSize: 20,
    color: '#555',
    marginBottom: 12,
  },
  detail: {
    fontSize: 16,
    color: '#555',
    marginTop: 4,
  },
  message: {
    fontSize: 18,
    color: '#888',
    textAlign: 'center',
  },
  error: {
    fontSize: 20,
    color: '#c00',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 14,
    color: '#c00',
    marginBottom: 12,
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    lineHeight: 18,
  },
});
