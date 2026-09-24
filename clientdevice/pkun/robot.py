"""Hook for P-kun's body (ROS 2). The UI calls signal(); robot nodes decide what to do with it.

When rclpy is available, each signal is published as JSON (std_msgs/String) on /pkun/ui_event, e.g.
  {"event": "notify", "kind": "MEDICINE"}   -> wag tail / turn to the patient / play a chime
  {"event": "response", "kind": "MEDICINE", "answer": "NO"}
  {"event": "request", "code": "HELP"}
  {"event": "game", "state": "correct"}
Without ROS (VM, laptop) signals are only logged.
"""
import json
import logging

log = logging.getLogger("pkun.robot")


class RobotBridge:
    def __init__(self):
        self._pub = None
        self._msg_type = None
        try:
            import rclpy
            from std_msgs.msg import String
            rclpy.init()
            node = rclpy.create_node("pkun_ui")
            self._pub = node.create_publisher(String, "/pkun/ui_event", 10)
            self._msg_type = String
            self._node = node
            log.info("ROS 2 bridge active on /pkun/ui_event")
        except Exception as e:  # rclpy missing or ROS not sourced
            log.info("ROS 2 not available (%s); robot signals are logged only", e.__class__.__name__)

    @property
    def available(self) -> bool:
        return self._pub is not None

    def signal(self, event: str, **data):
        body = json.dumps({"event": event, **data})
        log.debug("robot signal %s", body)
        if self._pub is not None:
            try:
                self._pub.publish(self._msg_type(data=body))
            except Exception as e:
                log.warning("ROS publish failed: %s", e)
