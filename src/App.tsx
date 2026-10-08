import { type FC } from 'react';
import AppBar from '@/components/AppBar';
import LegList from '@/components/LegList';
import TripMap from '@/components/TripMap';
import TripSummary from '@/components/TripSummary';
import Timeline from '@/components/timeline/Timeline';

const App: FC = () => (
  <div className="flex min-h-dvh flex-col bg-base-100 text-base-content">
    <AppBar />
    <main className="mx-auto flex w-full max-w-[1600px] grow flex-col gap-3 p-3 md:p-4">
      <TripSummary />
      <Timeline />
      {/* minmax(0, 1fr) on a phone too: an implicit grid column grows to its widest content (a
          drive's names, which never wrap) and would push the map and the drives off-screen. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:h-[640px] lg:grid-cols-[minmax(0,1fr)_400px]">
        <TripMap />
        <LegList />
      </div>
    </main>
    <footer className="px-4 pb-4 text-center text-[11px] text-base-content/40">
      Routing: Valhalla on OpenStreetMap data (ODbL) · Elevation: 国土地理院 標高タイル · Climate:{' '}
      <a className="link" href="https://open-meteo.com/">
        Open-Meteo
      </a>{' '}
      (CC BY 4.0) · Basemap: Esri, HERE, Garmin, © OpenStreetMap contributors
    </footer>
  </div>
);

export default App;
