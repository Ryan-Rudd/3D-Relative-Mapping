// App.tsx

import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Dimensions,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import KalmanFilter from 'kalmanjs';

interface Room {
  name: string;
  position: { x: number; y: number };
}

type Mode = 'origin' | 'mapping' | 'navigation';

const { width, height } = Dimensions.get('window');

export default function App() {
  // Application Modes
  const [mode, setMode] = useState<Mode>('origin');

  // Mapping and Navigation States
  const [rooms, setRooms] = useState<Room[]>([]);
  const [path, setPath] = useState<{ x: number; y: number }[]>([]);
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
  const [tempRoomName, setTempRoomName] = useState<string>('');
  const [originSet, setOriginSet] = useState<boolean>(false);

  // Origin Position
  const [origin, setOrigin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Current Position & Direction
  const [currentPosition, setCurrentPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [currentDirection, setCurrentDirection] = useState<number>(0); // In degrees
  const [currentRoom, setCurrentRoom] = useState<string>('');

  // IMU Data Subscriptions
  const accelSubscription = useRef<any>(null);
  const gyroSubscription = useRef<any>(null);
  const magSubscription = useRef<any>(null);

  // Movement Tracking
  const velocity = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const orientation = useRef<number>(0); // In degrees

  // Kalman Filters for smoothing
  const accelXFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));
  const accelYFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));
  const accelZFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));
  const gyroZFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));
  const magXFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));
  const magYFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));
  const magZFilter = useRef(new KalmanFilter({ R: 0.01, Q: 3 }));

  useEffect(() => {
    // Subscribe to Accelerometer
    Accelerometer.setUpdateInterval(50); // 50 ms for higher frequency
    accelSubscription.current = Accelerometer.addListener((data) => {
      const filteredX = accelXFilter.current.filter(data.x);
      const filteredY = accelYFilter.current.filter(data.y);
      const filteredZ = accelZFilter.current.filter(data.z);

      // Calculate magnitude of acceleration
      const magnitude = Math.sqrt(filteredX ** 2 + filteredY ** 2 + filteredZ ** 2);

      // Simple step detection based on acceleration threshold
      if (magnitude > 1.5) { // Increased threshold for better step detection
        // Update velocity based on direction
        const rad = (orientation.current * Math.PI) / 180;
        velocity.current.x += Math.cos(rad) * 0.5; // Assuming each step moves 0.5 units
        velocity.current.y += Math.sin(rad) * 0.5;
        const newX = origin.x + velocity.current.x;
        const newY = origin.y + velocity.current.y;

        setCurrentPosition({ x: newX, y: newY });
        setPath((prevPath) => [...prevPath, { x: newX, y: newY }]);
      }
    });

    // Subscribe to Gyroscope
    Gyroscope.setUpdateInterval(50); // 50 ms
    gyroSubscription.current = Gyroscope.addListener((data) => {
      const filteredZ = gyroZFilter.current.filter(data.z);
      // Integrate angular velocity to get orientation
      orientation.current += filteredZ * 50; // Multiply by time delta (0.05s)
      orientation.current = orientation.current % 360;
      setCurrentDirection(orientation.current);
    });

    // Subscribe to Magnetometer
    Magnetometer.setUpdateInterval(50); // 50 ms
    magSubscription.current = Magnetometer.addListener((data) => {
      const filteredX = magXFilter.current.filter(data.x);
      const filteredY = magYFilter.current.filter(data.y);
      const filteredZ = magZFilter.current.filter(data.z);
      // Calculate heading
      let heading = Math.atan2(filteredY, filteredX) * (180 / Math.PI);
      if (heading < 0) {
        heading += 360;
      }
      orientation.current = heading;
      setCurrentDirection(orientation.current);
    });

    return () => {
      // Clean up subscriptions on unmount
      accelSubscription.current && accelSubscription.current.remove();
      gyroSubscription.current && gyroSubscription.current.remove();
      magSubscription.current && magSubscription.current.remove();
    };
  }, [mode, origin]);

  // Effect to check current position against room positions in navigation mode
  useEffect(() => {
    if (mode === 'navigation') {
      for (let room of rooms) {
        const distance = Math.sqrt(
          Math.pow(currentPosition.x - room.position.x, 2) +
            Math.pow(currentPosition.y - room.position.y, 2)
        );
        if (distance < 1 && room.name !== currentRoom) { // Threshold distance
          setCurrentRoom(room.name);
          Alert.alert('You have entered:', room.name);
        }
      }
    }
  }, [currentPosition, mode, rooms, currentRoom]);

  // Handlers
  const handleSetOrigin = () => {
    setOrigin({ x: currentPosition.x, y: currentPosition.y });
    setOriginSet(true);
    setMode('mapping');
    Alert.alert('Origin Set', 'Origin has been set. Start mapping the house.');
  };

  const handleMarkRoom = () => {
    setIsModalVisible(true);
  };

  const handleSaveRoom = () => {
    if (tempRoomName.trim() === '') {
      Alert.alert('Error', 'Room name cannot be empty.');
      return;
    }
    const newRoom: Room = {
      name: tempRoomName,
      position: { x: currentPosition.x, y: currentPosition.y },
    };
    setRooms([...rooms, newRoom]);
    setTempRoomName('');
    setIsModalVisible(false);
    Alert.alert('Room Marked', `Room "${newRoom.name}" has been marked.`);
  };

  const handleFinishMapping = () => {
    if (rooms.length === 0) {
      Alert.alert('Error', 'Please mark at least one room.');
      return;
    }
    setMode('navigation');
    Alert.alert('Navigation Mode', 'You can now navigate through the house.');
  };

  const handleStartMapping = () => {
    setRooms([]);
    setPath([]);
    setCurrentPosition({ x: origin.x, y: origin.y });
    velocity.current = { x: 0, y: 0 };
    orientation.current = 0;
    setCurrentDirection(0);
    setCurrentRoom('');
    setMode('mapping');
    Alert.alert('Mapping Mode', 'Start walking and mark rooms.');
  };

  // Render Map using built-in View components
  const renderMap = () => {
    const mapWidth = width - 40;
    const mapHeight = height / 2;
    const scale = 20; // Scale factor for visualization

    // Center the map
    const centerX = mapWidth / 2;
    const centerY = mapHeight / 2;

    // Transform positions for visualization
    const transformedPath = path.map((point) => ({
      x: centerX + (point.x - origin.x) * scale,
      y: centerY - (point.y - origin.y) * scale,
    }));

    const transformedRooms = rooms.map((room) => ({
      x: centerX + (room.position.x - origin.x) * scale,
      y: centerY - (room.position.y - origin.y) * scale,
      name: room.name,
    }));

    const transformedCurrent = {
      x: centerX + (currentPosition.x - origin.x) * scale,
      y: centerY - (currentPosition.y - origin.y) * scale,
    };

    return (
      <View style={[styles.mapContainer, { width: mapWidth, height: mapHeight }]}>
        {/* Draw Path */}
        {transformedPath.map((point, index) => {
          if (index === 0) return null;
          const prevPoint = transformedPath[index - 1];
          const deltaX = point.x - prevPoint.x;
          const deltaY = point.y - prevPoint.y;
          const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
          return (
            <View
              key={`path-${index}`}
              style={{
                position: 'absolute',
                left: prevPoint.x,
                top: prevPoint.y,
                width: length,
                height: 2,
                backgroundColor: 'blue',
                transform: [{ rotateZ: `${angle}deg` }],
              }}
            />
          );
        })}

        {/* Draw Rooms */}
        {transformedRooms.map((room, index) => (
          <View
            key={`room-${index}`}
            style={[
              styles.roomMarker,
              { left: room.x - 10, top: room.y - 10 },
            ]}
          >
            <Text style={styles.roomLabel}>{room.name}</Text>
          </View>
        ))}

        {/* Draw Current Position */}
        <View
          style={[
            styles.currentPosition,
            { left: transformedCurrent.x - 10, top: transformedCurrent.y - 10 },
          ]}
        />
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {mode !== 'origin' && renderMap()}
      {mode === 'origin' ? (
        <View style={styles.modeContainer}>
          <Text style={styles.title}>Set Origin</Text>
          <Text style={styles.info}>
            Current Position: ({currentPosition.x.toFixed(2)}, {currentPosition.y.toFixed(2)})
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={handleSetOrigin}
          >
            <Text style={styles.buttonText}>Set Origin Here</Text>
          </TouchableOpacity>
        </View>
      ) : mode === 'mapping' ? (
        <View style={styles.modeContainer}>
          <Text style={styles.title}>Mapping Mode</Text>
          <Text style={styles.info}>
            Position: ({currentPosition.x.toFixed(2)}, {currentPosition.y.toFixed(2)})
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={handleMarkRoom}
          >
            <Text style={styles.buttonText}>Mark Room</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            onPress={handleFinishMapping}
          >
            <Text style={styles.buttonText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.modeContainer}>
          <Text style={styles.title}>Navigation Mode</Text>
          <Text style={styles.info}>
            Position: ({currentPosition.x.toFixed(2)}, {currentPosition.y.toFixed(2)})
          </Text>
          <Text style={styles.info}>
            Direction: {currentDirection.toFixed(2)}°
          </Text>
          {currentRoom !== '' && (
            <Text style={styles.currentRoom}>
              You are in: {currentRoom}
            </Text>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={handleStartMapping}
          >
            <Text style={styles.buttonText}>Restart Mapping</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modal for entering room name */}
      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Enter Room Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Room Name"
              value={tempRoomName}
              onChangeText={setTempRoomName}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={handleSaveRoom}
              >
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setIsModalVisible(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// Styles
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    paddingVertical: 40,
  },
  modeContainer: {
    alignItems: 'center',
    padding: 20,
  },
  mapContainer: {
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f9f9f9',
    marginBottom: 20,
    position: 'relative',
  },
  currentPosition: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'green',
    position: 'absolute',
  },
  roomMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'red',
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roomLabel: {
    position: 'absolute',
    top: -20,
    fontSize: 12,
    color: 'black',
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  info: {
    fontSize: 16,
    marginVertical: 5,
  },
  currentRoom: {
    fontSize: 20,
    color: 'green',
    marginVertical: 10,
  },
  button: {
    backgroundColor: '#4287f5',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginVertical: 8,
    minWidth: 180,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal Styles
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#4287f5',
    borderRadius: 10,
    width: '100%',
    padding: 10,
    marginBottom: 20,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    backgroundColor: '#4287f5',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 10,
    marginHorizontal: 5,
    flex: 1,
    alignItems: 'center',
  },
});
