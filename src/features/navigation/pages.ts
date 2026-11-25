import {
  BarChart3Icon,
  ImagesIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  ListTodoIcon,
  SettingsIcon,
  UsersIcon,
} from 'lucide-react'

export const navigationGroups = [
  {
    label: 'Product',
    items: [
      {
        title: 'Tasks',
        slug: 'tasks',
        icon: ListTodoIcon,
      },
      {
        title: 'Collections',
        slug: 'collections',
        icon: LayoutGridIcon,
      },
      {
        title: 'Media Library',
        slug: 'media',
        icon: ImagesIcon,
      },
      {
        title: 'Analytics',
        slug: 'analytics',
        icon: BarChart3Icon,
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        title: 'Users',
        slug: 'users',
        icon: UsersIcon,
      },
      {
        title: 'Access Tokens',
        slug: 'access-tokens',
        icon: KeyRoundIcon,
      },
      {
        title: 'Settings',
        slug: 'settings',
        icon: SettingsIcon,
      },
    ],
  },
] as const
