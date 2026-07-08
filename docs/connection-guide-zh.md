# Smart Reaction Pad v2 中文连接与使用指南

本指南适用于 `smart-reaction-pad-web-v2` 和 `SmartReactionPad_BLE.ino` v2 固件。

## 1. 项目定位

v2 是一个面向运动康复和 Return-to-Play 讨论的教育型原型。它可以记录六方向视觉选择踏步、Go/No-Go 抑制控制、空间侧差异和重复试次表现漂移。

它不是临床诊断设备，也不能单独作为复赛放行依据。

## 2. v2 的核心规则

本项目继续使用原组内规则：

```text
红色目标区域 = Go，需要踩
绿色目标区域 = No-Go，不要踩
```

这和日常“绿灯通行、红灯停止”的直觉相反，所以 v2 在正式记录前加入 practice trials。正式展示时务必先说明规则。

## 3. 烧录固件

打开 Arduino IDE，并打开：

```text
D:\零碎文件\Wearable\smart-reaction-pad-web-v2\firmware\SmartReactionPad_BLE\SmartReactionPad_BLE.ino
```

推荐设置：

```text
Board: ESP32 Dev Module
Port: 你的 ESP32 串口
Upload Speed: 921600 或 115200
Serial Monitor: 115200
```

需要库：

```text
Adafruit SSD1306
Adafruit GFX Library
Adafruit BusIO
ESP32 by Espressif Systems
```

如果上传失败，按住 BOOT 键上传；若仍失败，可临时拔掉 GPIO 2、5、12 上的数码管线，上传后再接回。

## 4. 开机现象

通电后应看到：

1. 数码管短暂显示 `8888`。
2. RGB 蓝灯表示等待 BLE。
3. OLED 显示 v2 系统提示。
4. 连接 BLE 后 RGB 变绿。

如果 OLED 不亮，请检查：

```text
VCC -> 3.3V/5V
GND -> GND
SDA -> GPIO21
SCL -> GPIO22
```

v2 固件会尝试 `0x3C` 和 `0x3D` 两个 I2C 地址。

## 5. Bluefy 连接步骤

1. 用 Bluefy 打开 GitHub Pages 网站。
2. 点击 `Connect BLE`。
3. 选择 `SmartReactionPad`。
4. 点击 `Calibrate`，保持六个 FSR 区域完全不受压。
5. 校准成功后选择 protocol。
6. 点击 `Start Protocol`。

注意：iPhone Safari 不支持 Web Bluetooth，因此必须使用 Bluefy。

## 6. 校准阶段

v2 会对六个 FSR 分别采集静止基线和噪声，并生成独立阈值：

```text
baseline_adc
press_threshold_adc
release_threshold_adc
```

如果任一区域静止时 ADC 过高，系统会认为可能存在 stuck-high 或安装压力异常，并拒绝开始正式测试。

## 7. 每个阶段的现象

### 待机

OLED 显示等待或 protocol 名称。数码管显示 protocol 编号。RGB 表示连接状态。

### Practice

Practice trial 不进入正式统计，用于让使用者理解：

```text
红灯踩
绿灯不踩
```

### WAIT_CLEAR

系统等待所有 FSR 释放。若脚还压在垫子上，正式刺激不会出现。

### READY_FOREPERIOD

RGB 黄灯，OLED 显示准备。区域灯全部熄灭。系统随机等待 2-7 秒。

如果此时提前踩踏，会记录为：

```text
false_start
```

该事件会被导出和统计，但不会作为有效 SRT。

### STIMULUS

红色目标区亮：尽快踩对应区域。  
绿色目标区亮：不要踩。

ESP32 从区域 LED 命令时刻开始计时，到 FSR 首次越过阈值为止。

### RESULT

RGB 和 OLED 显示本轮结果：

```text
go_correct
wrong_zone
false_alarm
correct_withhold
miss
anticipation
false_start
multi_contact
```

数码管显示最终 SRT 或 `----`。

## 8. 网页指标解释

### Stepping Response Time

刺激到足部接触时间，包含视觉感知、选择判断、姿势调整、踏步执行和 FSR 检测。不要称为纯神经反应时间。

### Spatial Side Comparison

比较左侧目标和右侧目标的表现。设备不能自动知道用户使用左脚还是右脚，因此默认不称为 LSI。

### Response Inhibition

Go/No-Go 抑制控制指标：

```text
Go hit rate
Go omission rate
No-Go commission rate
Correct rejection rate
```

### Performance Drift

比较早期和后期试次表现变化。它只能说明 time-on-task drift，不能直接诊断生理疲劳。

## 9. 安全说明

测试时应清理周围环境，避免跌倒。若使用者疼痛、失衡或需要停止，可按物理按钮或网页 Stop。v2 中运行状态下短按物理按钮会停止 session 并保留已记录数据。
