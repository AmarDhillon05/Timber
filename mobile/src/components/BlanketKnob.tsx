import { memo, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useSession, activeValues, activeTrack } from '../state/session';
import { BLANKET_TERMS, type BlanketTerm } from '../dsp/blanketTerms';

const SWEEP = 135; // degrees from center to each extreme (−1 → −135°, +1 → +135°)
const DRAG_RANGE = 160; // px of vertical drag to travel the full −1..1

const GLOW_USER = '#ef4444'; // red — editing your copy
const GLOW_GENERATED = '#22c55e'; // green — editing the generated copy

// A rotary knob bound to one Blanket term. Drag up to turn clockwise (increase),
// down to decrease. The dial is rendered with a raised, tactile 3D face (rim
// light, top sheen, centre hub) and springs up slightly while hovered or
// turned. Hovering reveals a tooltip explaining the term. Glows red on your
// copy, green on the generated copy. Subscribes to only its own value so
// turning one knob doesn't re-render the others.
function BlanketKnobBase({ term, disabled }: { term: BlanketTerm; disabled: boolean }) {
  const value = useSession((s) => activeValues(s)[term]);
  const setValue = useSession((s) => s.setValue);
  const glow = useSession((s) =>
    activeTrack(s)?.mode === 'generated' ? GLOW_GENERATED : GLOW_USER,
  );
  const { label, description } = BLANKET_TERMS[term];
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Latest props/value for the gesture closure (created once).
  const valueRef = useRef(value);
  valueRef.current = value;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const startValue = useRef(0);

  // 0 = resting, 1 = raised. Drives the spring "pop" while hovered or dragging.
  const lift = useRef(new Animated.Value(0)).current;
  const raised = (hovered || active) && !disabled;
  useEffect(() => {
    Animated.spring(lift, {
      toValue: raised ? 1 : 0,
      useNativeDriver: false,
      friction: 6,
      tension: 140,
    }).start();
  }, [raised, lift]);

  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: () => {
        startValue.current = valueRef.current;
        setActive(true);
      },
      onPanResponderMove: (_e, g) => {
        const delta = (-g.dy / DRAG_RANGE) * 2; // up = increase
        const next = Math.max(-1, Math.min(1, startValue.current + delta));
        setValue(term, next);
      },
      onPanResponderRelease: () => setActive(false),
      onPanResponderTerminate: () => setActive(false),
    }),
  ).current;

  return (
    <View style={[styles.wrap, hovered && styles.wrapHovered]}>
      {hovered && (
        <View style={styles.tooltipWrap} pointerEvents="none">
          <View style={styles.tooltip}>
            <Text style={styles.tooltipTitle}>{label}</Text>
            <Text style={styles.tooltipText}>{description}</Text>
          </View>
          <View style={styles.tooltipCaret} />
        </View>
      )}

      <Animated.View
        {...pan.panHandlers}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={[
          styles.lift,
          { transform: [{ translateY }, { scale }] },
          raised && styles.liftRaised,
          active && { shadowColor: glow, shadowOpacity: 0.7, shadowRadius: 16 },
        ]}
      >
        <View
          style={[
            styles.knob,
            disabled && styles.knobDisabled,
            active && { borderColor: glow },
          ]}
        >
          {/* Top-light sheen makes the face read as a raised dome. */}
          <View style={styles.sheen} pointerEvents="none" />

          <View
            style={[styles.pointerBox, { transform: [{ rotate: `${value * SWEEP}deg` }] }]}
            pointerEvents="none"
          >
            <View style={[styles.pointer, active && { backgroundColor: glow }]} />
          </View>

          {/* Recessed centre hub. */}
          <View style={styles.hub} pointerEvents="none" />
        </View>
      </Animated.View>

      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, active && { color: glow }]}>{value.toFixed(2)}</Text>
    </View>
  );
}

export const BlanketKnob = memo(BlanketKnobBase);

const SIZE = 60;
const HUB = 18;

const styles = StyleSheet.create({
  wrap: {
    width: 88,
    alignItems: 'center',
    paddingVertical: 8,
  },
  wrapHovered: {
    // Lift the hovered knob (and its tooltip) above its neighbours.
    zIndex: 50,
  },
  lift: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    // Resting drop shadow that gives the dial its raised, floating look.
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
  },
  liftRaised: {
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 9 },
    elevation: 12,
  },
  knob: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#28344a',
    borderWidth: 2,
    // Per-edge rim light: bright at the top, dark at the bottom, so the circle
    // looks like a bevelled dome catching light from above.
    borderTopColor: '#475a78',
    borderLeftColor: '#33425c',
    borderRightColor: '#33425c',
    borderBottomColor: '#0c1320',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knobDisabled: {
    opacity: 0.4,
  },
  sheen: {
    position: 'absolute',
    top: 3,
    width: SIZE * 0.74,
    height: SIZE * 0.5,
    borderRadius: SIZE,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  pointerBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 5,
  },
  pointer: {
    width: 4,
    height: 15,
    borderRadius: 2,
    backgroundColor: '#aebdd4',
  },
  hub: {
    position: 'absolute',
    width: HUB,
    height: HUB,
    borderRadius: HUB / 2,
    backgroundColor: '#1c2638',
    borderWidth: 1,
    borderTopColor: '#0c1320',
    borderBottomColor: '#3a4a66',
    borderLeftColor: '#23304a',
    borderRightColor: '#23304a',
  },
  label: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  value: {
    color: '#64748b',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  tooltipWrap: {
    position: 'absolute',
    bottom: '100%',
    width: 184,
    left: (88 - 184) / 2,
    alignItems: 'center',
    zIndex: 100,
  },
  tooltip: {
    backgroundColor: '#0b1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  tooltipTitle: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  tooltipText: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  tooltipCaret: {
    width: 10,
    height: 10,
    marginTop: -5,
    backgroundColor: '#0b1220',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#334155',
    transform: [{ rotate: '45deg' }],
  },
});
