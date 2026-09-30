import { PHASES } from '../../utils/conversationFlow'
import styles from './StatusBadge.module.css'

const PHASE_LABELS = {
  [PHASES.INTRO]:       { label: 'Starting…',       color: 'muted'   },
  [PHASES.WHAT_TRIED]:  { label: 'Q1: What tried?', color: 'accent'  },
  [PHASES.FOLLOWUP_1]:  { label: 'Follow-up 1',     color: 'accent'  },
  [PHASES.WHAT_BROKE]:  { label: 'Q2: What broke?', color: 'accent'  },
  [PHASES.FOLLOWUP_2]:  { label: 'Follow-up 2',     color: 'accent'  },
  [PHASES.WHY]:         { label: 'Q3: Why?',         color: 'accent'  },
  [PHASES.FOLLOWUP_3]:  { label: 'Follow-up 3',     color: 'accent'  },
  [PHASES.CONFIRM]:     { label: 'Confirm & Post',   color: 'warning' },
  [PHASES.DONE]:        { label: 'Done ✓',           color: 'success' },
}

export default function StatusBadge({ phase, isListening, agentBusy }) {
  const info = PHASE_LABELS[phase] ?? { label: phase, color: 'muted' }

  return (
    <div className="d-flex align-items-center gap-2">
      <span className={`${styles.badge} ${styles[info.color]}`}>
        {info.label}
      </span>
      {agentBusy && (
        <span className={styles.speaking}>
          <i className="bi bi-volume-up-fill me-1" />speaking
        </span>
      )}
      {isListening && (
        <span className={styles.listening}>
          <i className="bi bi-mic-fill me-1" />listening
        </span>
      )}
    </div>
  )
}
