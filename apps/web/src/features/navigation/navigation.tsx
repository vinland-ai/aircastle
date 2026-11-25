'use client'


import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { SearchIcon } from 'lucide-react'
import { navigationGroups } from '@/features/navigation/pages'
import { projectHref, useProjectParams } from './project'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

export function SidebarNavigation() {
  const params = useProjectParams()
  const pathname = usePathname()

  return navigationGroups.map((group) => (
    <SidebarGroup
      key={group.label}
      className="transition-[padding] duration-150 ease-out motion-reduce:transition-none group-data-[collapsible=icon]:py-0"
    >
      <SidebarGroupLabel className="mb-2 overflow-hidden group-data-[collapsible=icon]:mb-0 group-data-[collapsible=icon]:h-0">
        {group.label}
      </SidebarGroupLabel>
      <SidebarMenu>
        {group.items.map((item) => {
          const href = projectHref(params, item.slug)
          const active = pathname === href
          return (
            <SidebarMenuItem key={item.slug}>
              <SidebarMenuButton
                render={
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    data-active={active || undefined}
                  />
                }
                tooltip={item.title}
              >
                <item.icon aria-hidden="true" />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  ))
}

export function PageSearch() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const params = useProjectParams()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <Button
        aria-label="Search pages"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        variant="secondary"
        className="w-8 justify-start sm:w-40 sm:gap-2.5 xl:w-60"
        onClick={() => setOpen(true)}
      >
        <SearchIcon data-icon="inline-start" aria-hidden="true" className="text-muted-foreground" />
        <span className="hidden text-muted-foreground sm:inline">Search...</span>
        <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search pages"
        description="Find a page in your workspace."
      >
        <Command label="Pages">
          <CommandInput aria-label="Search pages" placeholder="Search pages..." />
          <CommandList>
            <CommandEmpty>No pages found.</CommandEmpty>
            {navigationGroups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.slug}
                    value={item.title}
                    onSelect={() => {
                      router.push(projectHref(params, item.slug))
                      setOpen(false)
                    }}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
