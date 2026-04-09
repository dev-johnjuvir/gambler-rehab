import Link from "next/link";
import styles from "./page.module.scss";

export default function OfflinePage() {
  return (
    <main className={styles.offline}>
      <div className={styles.offline__card}>
        <h1>Offline Mode</h1>
        <p>
          You are currently offline. Once the app has been loaded at least once, Scatter Rehab
          remains playable in offline mode.
        </p>
        <Link href="/">Return to game</Link>
      </div>
    </main>
  );
}
