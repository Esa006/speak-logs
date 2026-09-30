import styles from './Header.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <div className="container d-flex align-items-center gap-3">
        <div className={styles.logo}>
          <i className="bi bi-mic-fill" />
        </div>
        <div>
          <h1 className={styles.title}>SpeakLog</h1>
          <p className={styles.subtitle}>Voice-powered learning journal</p>
        </div>
      </div>
    </header>
  )
}
