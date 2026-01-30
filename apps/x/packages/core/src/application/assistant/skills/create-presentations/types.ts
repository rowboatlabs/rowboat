export interface SlideBase {
  type: string;
  title?: string;
  subtitle?: string;
  content?: string;
}

export interface TitleSlide extends SlideBase {
  type: 'title';
  title: string;
  subtitle?: string;
  presenter?: string;
}

export interface ContentSlide extends SlideBase {
  type: 'content';
  title: string;
  content?: string;
  items?: string[];
}

export interface SectionSlide extends SlideBase {
  type: 'section';
  title: string;
  subtitle?: string;
}

export interface StatsSlide extends SlideBase {
  type: 'stats';
  title: string;
  stats: Array<{ value: string; label: string }>;
  note?: string;
}

export interface TwoColumnSlide extends SlideBase {
  type: 'two-column';
  title: string;
  columns: [
    { title?: string; content?: string; items?: string[] },
    { title?: string; content?: string; items?: string[] }
  ];
}

export interface QuoteSlide extends SlideBase {
  type: 'quote';
  quote: string;
  attribution?: string;
}

export interface ImageSlide extends SlideBase {
  type: 'image';
  title: string;
  imagePath: string;
  caption?: string;
}

export interface TeamSlide extends SlideBase {
  type: 'team';
  title: string;
  members: Array<{
    name: string;
    role: string;
    bio?: string;
    photoPath?: string;
  }>;
}

export interface CTASlide extends SlideBase {
  type: 'cta';
  title: string;
  subtitle?: string;
  contact?: string;
}

export type Slide =
  | TitleSlide
  | ContentSlide
  | SectionSlide
  | StatsSlide
  | TwoColumnSlide
  | QuoteSlide
  | ImageSlide
  | TeamSlide
  | CTASlide;

export interface Theme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  textLight: string;
  background: string;
  backgroundAlt: string;
  fontFamily: string;
}

export interface PresentationData {
  slides: Slide[];
  theme?: Partial<Theme>;
}
