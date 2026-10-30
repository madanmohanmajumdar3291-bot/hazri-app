import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// AttendEye's signature element: a viewfinder with a progress ring/border
// that fills as detection confirms, then snaps to solid green/red. Reused
// at every face-recognition moment (check-in/out, enrollment, unlock) so
// "presence" always reads through the same recognizable motion.
//
// status: 'idle' | 'scanning' | 'success' | 'fail'
// Pass `width`/`height` for a larger rectangular viewfinder (attendance
// screens); omit them and just pass `size` for the small circular version
// (Menu Unlock).
export default function ScanRing({
  size = 200,
  width,
  height,
  cornerRadius = 28,
  status = 'idle',
  strokeWidth = 7,
  children,
}) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const scanLine = useRef(new Animated.Value(0)).current;
  const isRect = Boolean(width && height);
  const boxW = isRect ? width : size;
  const boxH = isRect ? height : size;
  const scanning = status === 'idle' || status === 'scanning';

  // QR-scanner-style laser line sweeping top to bottom, then snapping back —
  // sits inside the clipped viewfinder rather than a ring rotating around it.
  useEffect(() => {
    if (!scanning) {
      scanLine.stopAnimation();
      return;
    }
    scanLine.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, scanLine]);

  useEffect(() => {
    if (status === 'scanning') {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.02, duration: 550, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      ).start();
    } else {
      progress.stopAnimation();
      pulse.stopAnimation();
      pulse.setValue(1);
      progress.setValue(status === 'idle' ? 0 : 1);
    }
  }, [status, progress, pulse]);

  const ringColor = status === 'success' ? colors.success : status === 'fail' ? colors.error : colors.accent;
  const innerSize = size - strokeWidth * 3;
  const innerW = boxW - strokeWidth * 3;
  const innerH = boxH - strokeWidth * 3;
  const contentH = isRect ? innerH : innerSize;
  const scanLineY = scanLine.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(contentH - 3, 0)] });

  const radius = (size - strokeWidth) / 2;
  const circleCircumference = 2 * Math.PI * radius;
  const circleDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circleCircumference, 0],
  });

  const rectPerimeter = 2 * (boxW - strokeWidth) + 2 * (boxH - strokeWidth) - 8 * cornerRadius + 2 * Math.PI * cornerRadius;
  const rectDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [rectPerimeter, 0],
  });

  // A colored glow behind the ring on success/fail — subtle on Android
  // (elevation can't be tinted), a real soft-colored shadow on iOS.
  const glowColor = status === 'success' ? colors.success : status === 'fail' ? colors.error : null;

  return (
    <View
      style={[
        styles.wrap,
        { width: boxW, height: boxH },
        glowColor && {
          shadowColor: glowColor,
          shadowOpacity: 0.5,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 0 },
          elevation: 10,
        },
      ]}
    >
      {/* Camera/content sits in a plain, unanimated View — a native camera
          surface (SurfaceView/TextureView) breaks or freezes on many Android
          versions when its parent has an animated transform + clipped
          border-radius, so the pulse must never touch this subtree. */}
      <View
        style={[
          styles.inner,
          isRect
            ? { width: innerW, height: innerH, borderRadius: cornerRadius - strokeWidth, backgroundColor: colors.primary }
            : { width: innerSize, height: innerSize, borderRadius: innerSize / 2, backgroundColor: colors.primary },
        ]}
      >
        {children}
        {scanning && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scanLine,
              {
                width: isRect ? innerW : innerSize,
                backgroundColor: colors.accent,
                shadowColor: colors.accent,
                transform: [{ translateY: scanLineY }],
              },
            ]}
          />
        )}
      </View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { transform: [{ scale: pulse }] }]}
      >
        <Svg width={boxW} height={boxH} style={StyleSheet.absoluteFill}>
          {isRect ? (
            <>
              <Rect
                x={strokeWidth / 2}
                y={strokeWidth / 2}
                width={boxW - strokeWidth}
                height={boxH - strokeWidth}
                rx={cornerRadius}
                stroke={colors.border}
                strokeWidth={strokeWidth}
                fill="none"
              />
              <AnimatedRect
                x={strokeWidth / 2}
                y={strokeWidth / 2}
                width={boxW - strokeWidth}
                height={boxH - strokeWidth}
                rx={cornerRadius}
                stroke={ringColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={rectPerimeter}
                strokeDashoffset={status === 'idle' ? rectPerimeter : rectDashoffset}
                strokeLinecap="round"
              />
            </>
          ) : (
            <>
              <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
              <AnimatedCircle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={ringColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={circleCircumference}
                strokeDashoffset={status === 'idle' ? circleCircumference : circleDashoffset}
                strokeLinecap="round"
                rotation="-90"
                origin={`${size / 2}, ${size / 2}`}
              />
            </>
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 3,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
});

