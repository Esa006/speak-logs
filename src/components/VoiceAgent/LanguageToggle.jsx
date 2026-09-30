import styles from './LanguageToggle.module.css'

const LANGS = [
  { code: 'en-IN', label: 'English (IN)' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
]

export default function LanguageToggle({ lang, onChange, disabled }) {
  return (
    <div className={styles.toggle} role="group" aria-label="Language selection">
      {LANGS.map(l => (
        <button
          key={l.code}
          id={`lang-${l.code}`}
          className={`${styles.btn} ${lang === l.code ? styles.active : ''}`}
          onClick={() => onChange(l.code)}
          disabled={disabled}
          title={disabled ? 'Language can only be changed before starting' : `Switch to ${l.label}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
