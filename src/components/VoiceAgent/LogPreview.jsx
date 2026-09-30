import { formatLog } from '../../utils/conversationFlow'
import styles from './LogPreview.module.css'

export default function LogPreview({ log, posted, postError }) {
  const formatted = formatLog(log)

  return (
    <div className={`${styles.card} fade-in-up`}>
      <h2 className={styles.heading}>
        <i className="bi bi-journal-text me-2" />
        Your Log
        <span className={styles.verbatimTag}>verbatim</span>
      </h2>

      {posted ? (
        <div className={`alert alert-success mb-3 py-2`} role="status">
          <i className="bi bi-check-circle me-2" />
          {posted.mock
            ? `Saved locally — id: ${posted.id}`
            : `Log Saved Successfully ✅ — id: ${posted.id}`}
        </div>
      ) : postError ? (
        <div className="alert alert-danger mb-3 py-2" role="alert">
          <i className="bi bi-exclamation-circle me-2" />
          {postError}
        </div>
      ) : null}

      <pre className={styles.logText}>{formatted || '(no content yet)'}</pre>

      <p className={styles.note}>
        <i className="bi bi-info-circle me-1" />
        Your exact words are preserved — nothing has been rewritten.
      </p>
    </div>
  )
}
