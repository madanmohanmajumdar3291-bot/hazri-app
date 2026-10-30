import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Reads the direction out of instruction copy ("turn slightly left" / "turn
// slightly right") rather than adding a new prop every caller has to pass.
export function directionFromInstruction(instruction) {
  if (!instruction) return 'auto';
  const lower = instruction.toLowerCase();
  if (lower.includes('left')) return 'left';
  if (lower.includes('right')) return 'right';
  return 'auto';
}

// Samsung-Face-Unlock-style nudge: a face icon that visibly sweeps left,
// center, right, center — on a loop — so people learn to move their head
// without ever having to tap anything. `direction` 'left'/'right' (used
// mid-registration, while a specific instruction is showing) holds the lean
// toward that one side; 'auto' (attendance, Menu Unlock — no per-step
// instruction to follow) runs the full sweep continuously as a generic demo.
const SWEEP_LEG_MS = 550;

export default function FaceGuide({ direction = 'auto', colors, active = true }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.stopAnimation();
    if (!active) {
      anim.setValue(0);
      return;
    }

    if (direction === 'auto') {
      anim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: -1, duration: SWEEP_LEG_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: SWEEP_LEG_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1, duration: SWEEP_LEG_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: SWEEP_LEG_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }

    // Directed lean: nudge repeatedly toward the requested side.
    anim.setValue(0);
    const target = direction === 'left' ? -1 : 1;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: target, duration: SWEEP_LEG_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: SWEEP_LEG_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, direction, anim]);

  const translateX = anim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-16, 0, 16] });
  const rotate = anim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-24deg', '0deg', '24deg'] });

  return (
    <Animated.View style={{ transform: [{ translateX }, { rotate }] }}>
      <MaterialCommunityIcons name="face-man-outline" size={30} color={colors.accent} />
    </Animated.View>
  );
}
