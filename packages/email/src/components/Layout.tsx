import { Body, Container, Head, Hr, Html, Preview, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { styles } from '../styles';

export function EmailLayout({
  preview,
  children,
}: {
  preview: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Text style={styles.brand}>clip.al</Text>
          {children}
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            clip.al — short links, real analytics. This is a transactional message;
            we don’t send marketing to this address.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
