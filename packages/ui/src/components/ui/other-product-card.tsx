'use client'

import { ExternalLink, Globe } from 'lucide-react'
import { Button } from './button'
import { Card, CardContent } from './card'
import { RemoteImage } from './remote-image'

export const OTHER_PRODUCTS = [
  { id: 'lmspeed', domain: 'lmspeed.net', url: 'https://lmspeed.net/' },
  { id: 'clipii', domain: 'clipii.com', url: 'https://clipii.com/' }
] as const

export type OtherProductId = (typeof OTHER_PRODUCTS)[number]['id']

export function OtherProductCard({
  description,
  domain,
  href,
  name,
  visitLabel
}: {
  description: string
  domain: string
  href: string
  name: string
  visitLabel: string
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <RemoteImage
            alt=""
            className="size-10 shrink-0 overflow-hidden rounded-xl"
            fallbackIcon={<Globe aria-hidden className="size-5 text-muted-foreground" />}
            src={`https://favicon.im/${domain}?larger=true`}
          />
          <div className="min-w-0 space-y-1">
            <p className="font-medium leading-none">{name}</p>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
        </div>
        <Button asChild className="w-full gap-2" size="sm" variant="outline">
          <a href={href} rel="noopener noreferrer" target="_blank">
            <ExternalLink className="h-3.5 w-3.5" />
            {visitLabel}
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
