import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { CloudGradient, CloudGrain } from '@/components/brand/cloud-gradient'
import { AirWatcher } from './air-watcher'

/** The sign-in panel's art: sea-green folds on a rounded card that introduces Air, the same in every theme. */
export function CloudArt() {
  return (
    <div data-sign-in-art className="absolute inset-3 isolate overflow-hidden rounded-[28px]">
      <div data-sign-in-backdrop aria-hidden="true" className="absolute inset-0 bg-[#2c8b7a]">
        <CloudGradient id="sign-in" look="seaFolds" />
        <CloudGrain />
      </div>
      <Link
        href="/"
        className="group absolute top-7 left-7 z-10 inline-flex items-center gap-1.5 rounded-md text-base text-white/80 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-solid"
      >
        <ArrowLeftIcon
          aria-hidden="true"
          className="size-4 transition-transform group-hover:-translate-x-0.5"
        />
        Home
      </Link>
      <div className="relative flex h-full items-center justify-center">
        <p
          data-sign-in-greeting
          className="flex items-center gap-[0.25em] text-[5rem] leading-none font-[300] tracking-[-0.03em] text-white [text-shadow:0_1px_16px_rgb(10_60_60/0.25)]"
        >
          Meet
          <AirWatcher eyeColour="#3a9a86" />
          Air
        </p>
      </div>
    </div>
  )
}
