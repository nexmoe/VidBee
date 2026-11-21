import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'
import { Badge } from '@renderer/components/ui/badge'
import { Input } from '@renderer/components/ui/input'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import type { DesktopMcpCapabilityGroup } from '@shared/mcp'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Browse and search registered capabilities in a section that starts collapsed. */
export function McpCapabilities({
  groups,
  loading
}: {
  groups: DesktopMcpCapabilityGroup[]
  loading: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const needle = query.trim().toLocaleLowerCase()
  const counts = { tools: 0, resources: 0, prompts: 0 }
  for (const group of groups) {
    counts[group.kind] += group.items.length
  }
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${t(`settings.mcp.capabilities.${item.labelKey}`, { defaultValue: item.description })}\n${item.name}\n${item.description}`
          .toLocaleLowerCase()
          .includes(needle)
      )
    }))
    .filter((group) => group.items.length)

  return (
    <Accordion collapsible data-testid="mcp-capabilities" type="single">
      <AccordionItem className="border-0" value="capabilities">
        <AccordionTrigger className="px-1 hover:no-underline">
          <span className="space-y-1">
            <span className="block font-medium">{t('settings.mcp.capabilitiesTitle')}</span>
            <span className="block font-normal text-muted-foreground">
              {loading
                ? t('settings.mcp.loading')
                : t('settings.mcp.capabilitiesDescription', counts)}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pb-0">
          <Input
            aria-label={t('settings.mcp.searchCapabilities')}
            disabled={loading}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings.mcp.searchCapabilities')}
            type="search"
            value={query}
          />
          <ItemGroup>
            <Accordion
              onValueChange={setExpanded}
              type="multiple"
              value={needle ? filteredGroups.map((group) => group.id) : expanded}
            >
              {filteredGroups.map((group, index) => (
                <Fragment key={group.id}>
                  {index > 0 && <ItemSeparator />}
                  <AccordionItem className="border-0" value={group.id}>
                    <AccordionTrigger className="rounded-none bg-muted/40 px-4 hover:no-underline">
                      <span className="flex items-center gap-2">
                        {t(`settings.mcp.groups.${group.id}`, { defaultValue: group.id })}
                        <Badge className="tabular-nums" variant="secondary">
                          {group.items.length}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0">
                      {group.items.map((item, itemIndex) => (
                        <Fragment key={item.name}>
                          {itemIndex > 0 && <ItemSeparator />}
                          <Item data-mcp-capability={item.name} size="sm" variant="muted">
                            <ItemContent className="min-w-0">
                              <ItemTitle>
                                {t(`settings.mcp.capabilities.${item.labelKey}`, {
                                  defaultValue: item.description
                                })}
                              </ItemTitle>
                              <ItemDescription className="break-all font-mono text-xs">
                                {item.name}
                              </ItemDescription>
                            </ItemContent>
                          </Item>
                        </Fragment>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                </Fragment>
              ))}
            </Accordion>
            {!loading && filteredGroups.length === 0 && (
              <Item variant="muted">
                <ItemDescription>{t('settings.mcp.noCapabilities')}</ItemDescription>
              </Item>
            )}
          </ItemGroup>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
