# 大肥鱼陪伴形象

当前使用 bigfish-poses-short.png（六种短腿表情，3×2 图集）及 bigfish-walk-proportions.png（四帧短腿行走，2×2 图集）。素材通过内置 image_gen 基于用户提供并确认的角色样板生成。

本次只缩短行走素材裙摆以下的腿部，保留手臂和步态。以相同头部大小对照站姿，裙摆到鞋底只露出短短一截，避免状态切换时突然变成长腿。渲染框同时校正以对齐脚底。四帧为逐帧动画，朝左时镜像，节奏按实际移动速度计算。

## 腿部比例修正提示词

Precise proportion correction. Image 1 is EDIT TARGET, current 2x2 walking atlas. Image 2 is the APPROVED short-leg proportion reference. Edit ONLY legs and shoes in ALL FOUR cells of image 1. Keep head, hair, torso, dress, arms, hands, tail, pose direction, rendering, transparency and 2x2 grid unchanged. The walking legs are currently much TOO LONG. SHORTEN BOTH LEGS IN EVERY FRAME by 60 percent measured along the limb, bringing feet up close beneath skirt hem. Match image2's tiny stubby legs: from lowest skirt hem to bottom of shoe only about 8-10 percent of total character height, stockings visible only a very small sliver above shoes. Shoes compact, not elongated. Keep leg bends and alternating front/back positions but with TINY short steps, no large stride, no long thighs or shins. Do NOT shrink or stretch the whole character, do NOT make head bigger to fake the ratio; physically shorten the leg anatomy only. Move the ankle and shoe UP toward skirt. Hair and tail may end at skirt bottom but must not extend below the raised new feet. All four characters same scale and foot baseline, keep upper-body positions registered. Leave newly freed canvas below feet completely TRANSPARENT. Do not fill with background. No labels or guides. Output square transparent 2x2 sheet. Crucial: actual leg length must match the short-leg STANDING reference; do not preserve the bad long legs from edit target.
