import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToFile,
} from '@react-pdf/renderer';
import type { Slide, Theme, PresentationData, TitleSlide, ContentSlide, SectionSlide, StatsSlide, TwoColumnSlide, QuoteSlide, ImageSlide, TeamSlide, CTASlide } from './types.js';

const defaultTheme: Theme = {
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  accentColor: '#f59e0b',
  textColor: '#1f2937',
  textLight: '#6b7280',
  background: '#ffffff',
  backgroundAlt: '#f9fafb',
  fontFamily: 'Helvetica',
};

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    slide: {
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      padding: 60,
      backgroundColor: theme.background,
      position: 'relative',
    },
    slideAlt: {
      backgroundColor: theme.backgroundAlt,
    },
    slideGradient: {
      backgroundColor: theme.primaryColor,
    },
    pageNumber: {
      position: 'absolute',
      bottom: 30,
      right: 40,
      fontSize: 14,
      color: theme.textLight,
    },
    slideTitle: {
      fontSize: 42,
      fontWeight: 'bold',
      color: theme.textColor,
      marginBottom: 30,
    },
    slideBody: {
      fontSize: 24,
      color: theme.textColor,
      lineHeight: 1.6,
    },
    titleSlide: {
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    mainTitle: {
      fontSize: 64,
      fontWeight: 'bold',
      color: '#ffffff',
      textAlign: 'center' as const,
      marginBottom: 20,
    },
    mainSubtitle: {
      fontSize: 28,
      color: 'rgba(255, 255, 255, 0.9)',
      textAlign: 'center' as const,
      marginBottom: 30,
    },
    presenter: {
      fontSize: 20,
      color: 'rgba(255, 255, 255, 0.8)',
      textAlign: 'center' as const,
    },
    titleDecoration: {
      position: 'absolute' as const,
      bottom: 0,
      left: 0,
      right: 0,
      height: 8,
      backgroundColor: theme.accentColor,
    },
    sectionNumber: {
      fontSize: 80,
      fontWeight: 'bold',
      color: theme.primaryColor,
      opacity: 0.2,
      marginBottom: -20,
    },
    sectionTitle: {
      fontSize: 56,
      fontWeight: 'bold',
      color: theme.textColor,
    },
    sectionSubtitle: {
      fontSize: 24,
      color: theme.textLight,
      marginTop: 15,
    },
    contentList: {
      marginTop: 10,
    },
    listItem: {
      flexDirection: 'row' as const,
      marginBottom: 16,
      alignItems: 'flex-start' as const,
    },
    listBullet: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: theme.primaryColor,
      marginRight: 20,
      marginTop: 8,
    },
    listText: {
      flex: 1,
      fontSize: 24,
      color: theme.textColor,
      lineHeight: 1.5,
    },
    columnsContainer: {
      flexDirection: 'row' as const,
      flex: 1,
      gap: 60,
    },
    column: {
      flex: 1,
    },
    columnTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.primaryColor,
      marginBottom: 15,
    },
    statsGrid: {
      flexDirection: 'row' as const,
      justifyContent: 'space-around' as const,
      alignItems: 'center' as const,
      flex: 1,
    },
    statItem: {
      alignItems: 'center' as const,
      padding: 30,
    },
    statValue: {
      fontSize: 72,
      fontWeight: 'bold',
      color: theme.primaryColor,
      marginBottom: 10,
    },
    statLabel: {
      fontSize: 20,
      color: theme.textLight,
      textTransform: 'uppercase' as const,
      letterSpacing: 1,
    },
    statsNote: {
      textAlign: 'center' as const,
      fontSize: 18,
      color: theme.textLight,
      marginTop: 20,
    },
    quoteSlide: {
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    quoteText: {
      fontSize: 36,
      fontStyle: 'italic',
      color: theme.textColor,
      textAlign: 'center' as const,
      maxWidth: 900,
      lineHeight: 1.5,
    },
    quoteAttribution: {
      fontSize: 20,
      color: theme.textLight,
      marginTop: 30,
      textAlign: 'center' as const,
    },
    imageContainer: {
      flex: 1,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      marginVertical: 20,
    },
    slideImage: {
      maxWidth: '100%',
      maxHeight: 450,
      objectFit: 'contain' as const,
    },
    imageCaption: {
      textAlign: 'center' as const,
      fontSize: 18,
      color: theme.textLight,
    },
    teamGrid: {
      flexDirection: 'row' as const,
      justifyContent: 'center' as const,
      gap: 50,
      flex: 1,
      alignItems: 'center' as const,
    },
    teamMember: {
      alignItems: 'center' as const,
      maxWidth: 200,
    },
    memberPhotoPlaceholder: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: theme.primaryColor,
      marginBottom: 15,
    },
    memberPhoto: {
      width: 120,
      height: 120,
      borderRadius: 60,
      marginBottom: 15,
    },
    memberName: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.textColor,
      textAlign: 'center' as const,
    },
    memberRole: {
      fontSize: 16,
      color: theme.primaryColor,
      marginTop: 5,
      textAlign: 'center' as const,
    },
    memberBio: {
      fontSize: 14,
      color: theme.textLight,
      marginTop: 10,
      textAlign: 'center' as const,
      lineHeight: 1.4,
    },
    ctaSlide: {
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    ctaTitle: {
      fontSize: 56,
      fontWeight: 'bold',
      color: '#ffffff',
      textAlign: 'center' as const,
      marginBottom: 20,
    },
    ctaSubtitle: {
      fontSize: 24,
      color: 'rgba(255, 255, 255, 0.9)',
      textAlign: 'center' as const,
      marginBottom: 40,
    },
    ctaContact: {
      fontSize: 20,
      color: 'rgba(255, 255, 255, 0.8)',
      textAlign: 'center' as const,
    },
  });

type Styles = ReturnType<typeof createStyles>;

const TitleSlideComponent: React.FC<{ slide: TitleSlide; styles: Styles }> = ({ slide, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={[styles.slide, styles.slideGradient, styles.titleSlide]}>
    <Text style={styles.mainTitle}>{slide.title}</Text>
    {slide.subtitle && <Text style={styles.mainSubtitle}>{slide.subtitle}</Text>}
    {slide.presenter && <Text style={styles.presenter}>{slide.presenter}</Text>}
    <View style={styles.titleDecoration} />
  </Page>
);

const SectionSlideComponent: React.FC<{ slide: SectionSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={[styles.slide, styles.slideAlt]}>
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Text style={styles.sectionNumber}>{String(pageNum).padStart(2, '0')}</Text>
      <Text style={styles.sectionTitle}>{slide.title}</Text>
      {slide.subtitle && <Text style={styles.sectionSubtitle}>{slide.subtitle}</Text>}
    </View>
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const ContentSlideComponent: React.FC<{ slide: ContentSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={styles.slide}>
    <Text style={styles.slideTitle}>{slide.title}</Text>
    {slide.content && <Text style={styles.slideBody}>{slide.content}</Text>}
    {slide.items && (
      <View style={styles.contentList}>
        {slide.items.map((item, i) => (
          <View key={i} style={styles.listItem}>
            <View style={styles.listBullet} />
            <Text style={styles.listText}>{item}</Text>
          </View>
        ))}
      </View>
    )}
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const TwoColumnSlideComponent: React.FC<{ slide: TwoColumnSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={styles.slide}>
    <Text style={styles.slideTitle}>{slide.title}</Text>
    <View style={styles.columnsContainer}>
      {slide.columns.map((col, i) => (
        <View key={i} style={styles.column}>
          {col.title && <Text style={styles.columnTitle}>{col.title}</Text>}
          {col.content && <Text style={styles.slideBody}>{col.content}</Text>}
          {col.items && (
            <View style={styles.contentList}>
              {col.items.map((item, j) => (
                <View key={j} style={styles.listItem}>
                  <View style={styles.listBullet} />
                  <Text style={styles.listText}>{item}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const StatsSlideComponent: React.FC<{ slide: StatsSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={styles.slide}>
    <Text style={styles.slideTitle}>{slide.title}</Text>
    <View style={styles.statsGrid}>
      {slide.stats.map((stat, i) => (
        <View key={i} style={styles.statItem}>
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text style={styles.statLabel}>{stat.label}</Text>
        </View>
      ))}
    </View>
    {slide.note && <Text style={styles.statsNote}>{slide.note}</Text>}
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const QuoteSlideComponent: React.FC<{ slide: QuoteSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={[styles.slide, styles.slideAlt, styles.quoteSlide]}>
    <Text style={styles.quoteText}>"{slide.quote}"</Text>
    {slide.attribution && <Text style={styles.quoteAttribution}>— {slide.attribution}</Text>}
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const ImageSlideComponent: React.FC<{ slide: ImageSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={styles.slide}>
    <Text style={styles.slideTitle}>{slide.title}</Text>
    <View style={styles.imageContainer}>
      <Image src={slide.imagePath} style={styles.slideImage} />
    </View>
    {slide.caption && <Text style={styles.imageCaption}>{slide.caption}</Text>}
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const TeamSlideComponent: React.FC<{ slide: TeamSlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={styles.slide}>
    <Text style={styles.slideTitle}>{slide.title}</Text>
    <View style={styles.teamGrid}>
      {slide.members.map((member, i) => (
        <View key={i} style={styles.teamMember}>
          {member.photoPath ? (
            <Image src={member.photoPath} style={styles.memberPhoto} />
          ) : (
            <View style={styles.memberPhotoPlaceholder} />
          )}
          <Text style={styles.memberName}>{member.name}</Text>
          <Text style={styles.memberRole}>{member.role}</Text>
          {member.bio && <Text style={styles.memberBio}>{member.bio}</Text>}
        </View>
      ))}
    </View>
    <Text style={styles.pageNumber}>{pageNum}</Text>
  </Page>
);

const CTASlideComponent: React.FC<{ slide: CTASlide; pageNum: number; styles: Styles }> = ({ slide, pageNum, styles }) => (
  <Page size={[SLIDE_WIDTH, SLIDE_HEIGHT]} style={[styles.slide, styles.slideGradient, styles.ctaSlide]}>
    <Text style={styles.ctaTitle}>{slide.title}</Text>
    {slide.subtitle && <Text style={styles.ctaSubtitle}>{slide.subtitle}</Text>}
    {slide.contact && <Text style={styles.ctaContact}>{slide.contact}</Text>}
    <Text style={[styles.pageNumber, { color: 'rgba(255,255,255,0.6)' }]}>{pageNum}</Text>
  </Page>
);

const renderSlide = (
  slide: Slide,
  index: number,
  styles: Styles
): React.ReactElement => {
  const pageNum = index + 1;

  switch (slide.type) {
    case 'title':
      return <TitleSlideComponent key={index} slide={slide} styles={styles} />;
    case 'section':
      return <SectionSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'content':
      return <ContentSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'two-column':
      return <TwoColumnSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'stats':
      return <StatsSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'quote':
      return <QuoteSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'image':
      return <ImageSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'team':
      return <TeamSlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    case 'cta':
      return <CTASlideComponent key={index} slide={slide} pageNum={pageNum} styles={styles} />;
    default:
      return <ContentSlideComponent key={index} slide={slide as ContentSlide} pageNum={pageNum} styles={styles} />;
  }
};

const Presentation: React.FC<PresentationData> = ({ slides, theme }) => {
  const mergedTheme = { ...defaultTheme, ...theme };
  const styles = createStyles(mergedTheme);

  return <Document>{slides.map((slide, i) => renderSlide(slide, i, styles))}</Document>;
};

export async function generatePresentation(
  data: PresentationData,
  outputPath: string
): Promise<string> {
  await renderToFile(<Presentation {...data} />, outputPath);
  return outputPath;
}
