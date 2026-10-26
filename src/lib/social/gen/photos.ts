/**
 * Licensed photos the social generator may put behind a slide: the Wikimedia Commons originals (up to 2,000 px on the
 * short edge, so a portrait Reel crop is not upscaled much), credited in scripts/social/assets/photos/CREDITS.md. `file`
 * is relative to the repo root. `attribution` = the license requires a visible credit, which the renderer prints on the slide.
 */
export interface SocialPhoto {
  file: string;
  credit: string;
  license: string;
  sourceUrl: string;
  attribution: boolean;
  /** What the photo shows, for alt text. */
  alt: string;
}

export const PHOTOS = {
  'ca-tile-roof': {
    file: 'scripts/social/assets/photos/ca-tile-roof.jpg',
    credit: 'Senthil Balasubramanian, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Balasubramanian_000277_173009_518477_4578_(36824326171).jpg',
    attribution: false,
    alt: 'Solar panels on the tile roof of a California home',
  },
  'ca-rooftop-install': {
    file: 'scripts/social/assets/photos/ca-rooftop-install.jpg',
    credit: 'Laksh Muchhal, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Muchhal_000262_172296_517453_4578_(36963527475).jpg',
    attribution: false,
    alt: 'Rooftop solar panels on a home',
  },
  'ca-battery-home': {
    file: 'scripts/social/assets/photos/ca-battery-home.jpg',
    credit: 'Laksh Muchhal, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Muchhal_000422_172295_517451_4578_(36155265553).jpg',
    attribution: false,
    alt: 'A California home with rooftop solar',
  },
  'home-value': {
    file: 'scripts/social/assets/photos/home-value.jpg',
    credit: 'Olivia Martin, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Martin_000411_163329_506910_4578_(36776433336).jpg',
    attribution: false,
    alt: 'A house with solar panels on the roof',
  },
  'worth-it': {
    file: 'scripts/social/assets/photos/worth-it.jpg',
    credit: 'Olivia Martin, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Martin_000410_163328_506909_4578_(36792947532).jpg',
    attribution: false,
    alt: 'Residential rooftop solar array',
  },
  'compare-quotes': {
    file: 'scripts/social/assets/photos/compare-quotes.jpg',
    credit: 'Kristelle Batucal, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Batucal_000281_173184_518703_4578_(36963958445).jpg',
    attribution: false,
    alt: 'Solar panels on a residential roof',
  },
  'install-crew': {
    file: 'scripts/social/assets/photos/install-crew.jpg',
    credit: 'Laksh Muchhal, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Muchhal_000261_172294_517438_4578_(36775930566).jpg',
    attribution: false,
    alt: 'Solar panels being installed on a roof',
  },
  'lease-vs-buy': {
    file: 'scripts/social/assets/photos/lease-vs-buy.jpg',
    credit: 'Chris Wingard, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Wingard_000027_157448_497660_4578_(36293688136).jpg',
    attribution: false,
    alt: 'A home with a rooftop solar system',
  },
  'fl-broward-roof': {
    file: 'scripts/social/assets/photos/fl-broward-roof.jpg',
    credit: 'Paul Krashefski, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Krashefski_000384_172797_517878_4578_(36776409046).jpg',
    attribution: false,
    alt: 'Rooftop solar array in Broward County, Florida',
  },
  'fl-rooftop-1': {
    file: 'scripts/social/assets/photos/fl-rooftop-1.jpg',
    credit: 'Paul Krashefski, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Krashefski_000387_172808_517946_4578_(36776407386).jpg',
    attribution: false,
    alt: 'Rooftop solar panels in Florida',
  },
  'fl-rooftop-2': {
    file: 'scripts/social/assets/photos/fl-rooftop-2.jpg',
    credit: 'Paul Krashefski, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Krashefski_000386_172807_517943_4578_(36776407836).jpg',
    attribution: false,
    alt: 'Solar panels on a Florida roof',
  },
  'fl-rooftop-3': {
    file: 'scripts/social/assets/photos/fl-rooftop-3.jpg',
    credit: 'Paul Krashefski, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Krashefski_000203_172813_517968_4578_(35949235064).jpg',
    attribution: false,
    alt: 'Rooftop solar in Florida',
  },
  'ca-net-billing': {
    file: 'scripts/social/assets/photos/ca-net-billing.jpg',
    credit: 'Kate Costa, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Costa_000353_172268_517421_4578_(36792955422).jpg',
    attribution: false,
    alt: 'A home with rooftop solar panels',
  },
  'rooftop-wide': {
    file: 'scripts/social/assets/photos/rooftop-wide.jpg',
    credit: 'Kate Costa, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Costa_000351_172266_517428_4578_(36776415206).jpg',
    attribution: false,
    alt: 'Residential rooftop solar',
  },
  'home-battery': {
    file: 'scripts/social/assets/photos/home-battery.jpg',
    credit: 'Rsparks3',
    license: 'CC0 1.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Two_Tesla_power_wall_3_devices_installed_inside_in_a_residential_home.jpg',
    attribution: false,
    alt: 'Two home batteries installed on a wall inside a house',
  },
  'power-lines-sunset': {
    file: 'scripts/social/assets/photos/power-lines-sunset.jpg',
    credit: 'Eric Sonstroem',
    license: 'CC BY 2.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sunset_with_Power_Lines_(26993470630).jpg',
    attribution: true,
    alt: 'Power lines at sunset',
  },
  'fl-panels-sunrise': {
    file: 'scripts/social/assets/photos/fl-panels-sunrise.jpg',
    credit: 'Paul Krashefski, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Krashefski_000256_172810_517957_4578_(36963529655).jpg',
    attribution: false,
    alt: 'Rooftop solar panels at sunrise in Broward County, Florida',
  },
  'fl-broward-array': {
    file: 'scripts/social/assets/photos/fl-broward-array.jpg',
    credit: 'Paul Krashefski, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Krashefski_000385_172800_517887_4578_(36776408736).jpg',
    attribution: false,
    alt: 'A rooftop solar array being installed in Broward County, Florida',
  },
  'home-suburban': {
    file: 'scripts/social/assets/photos/home-suburban.jpg',
    credit: 'Senthil Balasubramanian, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Balasubramanian_000276_173008_518485_4578_(36963959255).jpg',
    attribution: false,
    alt: 'A suburban house with solar panels on the roof',
  },
  'home-patio': {
    file: 'scripts/social/assets/photos/home-patio.jpg',
    credit: 'Olivia Martin, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Martin_000409_163327_506905_4578_(36155266063).jpg',
    attribution: false,
    alt: 'A home with rooftop solar seen from its back patio',
  },
  'roof-sky': {
    file: 'scripts/social/assets/photos/roof-sky.jpg',
    credit: 'Olivia Martin, U.S. Department of Energy',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Martin_000408_163326_506904_4578_(36776403016).jpg',
    attribution: false,
    alt: 'Solar panels on a steep roof against the sky',
  },
} as const satisfies Record<string, SocialPhoto>;

export type PhotoKey = keyof typeof PHOTOS;

export const photoByKey = (key: PhotoKey): SocialPhoto => PHOTOS[key];
