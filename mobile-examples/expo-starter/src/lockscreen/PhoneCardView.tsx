/**
 * The lock-screen medical ID saved on this phone, as a responder sees it.
 *
 * Renders only what the server put on the card. An allergy line the server
 * could not read says so; nothing here supplies "no allergies" for a value
 * that is absent.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { SavedCard } from './phoneCard';

export function PhoneCardView({ saved }: { saved: SavedCard }) {
  const { card } = saved;
  const contact = card.emergency_contact;
  return (
    <View style={styles.card} accessibilityLabel="Medical ID saved on this phone">
      <Text style={styles.label}>MEDICAL ID</Text>
      {card.name?.value ? <Text style={styles.name}>{card.name.value}</Text> : null}
      <Text style={styles.blood}>{card.blood_type?.value ?? 'Blood type not on the card'}</Text>
      <Text style={styles.line}>{card.allergies_line?.text ?? 'Allergies not on the card'}</Text>
      {card.dnr_line?.text ? <Text style={styles.dnr}>{card.dnr_line.text}</Text> : null}
      {contact?.name || contact?.phone ? (
        <Text style={styles.line}>
          Contact: {[contact.name, contact.relationship ? `(${contact.relationship})` : null, contact.phone]
            .filter(Boolean).join(' ')}
        </Text>
      ) : null}
      <Text style={styles.saved}>Saved on this phone {new Date(saved.savedAt).toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1F2937', borderRadius: 16, padding: 20, width: '100%' },
  label: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  name: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginTop: 4 },
  blood: { color: '#FFFFFF', fontSize: 44, fontWeight: '800', marginTop: 8 },
  line: { color: '#F3F4F6', fontSize: 17, marginTop: 8 },
  dnr: { color: '#FCA5A5', fontSize: 17, fontWeight: '800', marginTop: 8 },
  saved: { color: '#9CA3AF', fontSize: 12, marginTop: 12 },
});
