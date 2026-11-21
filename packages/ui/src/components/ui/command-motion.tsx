import { spring as createSpring } from 'framer-motion'
import type { CSSProperties } from 'react'
import { spring } from '../../lib/springs'

/** Generate native CSS timing from the same spring tokens used by Motion components. */
function springCss(tier: { duration: number; bounce: number }): string {
  return createSpring({
    keyframes: [0, 1],
    duration: tier.duration * 1000,
    bounce: tier.bounce
  }).toString()
}

export const commandMotionStyle = {
  '--command-dialog-enter': springCss(spring.slow),
  '--command-dialog-exit': `${spring.slow.exit.duration}s`,
  '--command-list-transition': springCss(spring.moderate)
} as CSSProperties
