/**
 * 清除数据库中的所有房间记录
 *
 * 使用方法:
 *   node scripts/clear-rooms.js
 *
 * 选项:
 *   --all          删除所有房间（包括活跃和非活跃）
 *   --inactive     只删除非活跃房间（默认）
 *   --force        跳过确认提示，直接删除
 */

require('dotenv').config();
const { Room, User, Message, IceCandidate, SdpSignal, sequelize } = require('../src/models');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 解析命令行参数
const args = process.argv.slice(2);
const options = {
  all: args.includes('--all'),
  inactive: args.includes('--inactive') || (!args.includes('--all')),
  force: args.includes('--force')
};

// 提示用户确认
function askConfirmation(message) {
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function clearRooms() {
  try {
    console.log('🗑️  清除房间工具\n');

    // 连接数据库
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功\n');

    // 查询房间数量
    const whereClause = options.all ? {} : { is_active: false };
    const roomCount = await Room.count({ where: whereClause });

    if (roomCount === 0) {
      console.log('ℹ️  没有找到需要删除的房间');
      rl.close();
      process.exit(0);
    }

    // 显示将要删除的房间信息
    const rooms = await Room.findAll({
      where: whereClause,
      include: [{
        model: User,
        as: 'users'
      }]
    });

    console.log(`📊 找到 ${roomCount} 个房间：\n`);
    rooms.forEach((room, index) => {
      console.log(`${index + 1}. 房间 ID: ${room.room_id}`);
      console.log(`   名称: ${room.name || '(无名称)'}`);
      console.log(`   状态: ${room.is_active ? '活跃' : '非活跃'}`);
      console.log(`   私人: ${room.is_private ? '是' : '否'}`);
      console.log(`   用户数: ${room.users.length}`);
      console.log(`   创建于: ${room.created_at}`);
      console.log('');
    });

    // 统计相关数据
    const userCount = await User.count({
      where: {
        room_id: rooms.map(r => r.id)
      }
    });

    const messageCount = await Message.count({
      where: {
        room_id: rooms.map(r => r.id)
      }
    });

    const iceCandidateCount = await IceCandidate.count({
      where: {
        room_id: rooms.map(r => r.id)
      }
    });

    const sdpSignalCount = await SdpSignal.count({
      where: {
        room_id: rooms.map(r => r.id)
      }
    });

    console.log('📈 相关数据统计：');
    console.log(`   用户记录: ${userCount}`);
    console.log(`   聊天消息: ${messageCount}`);
    console.log(`   ICE Candidates: ${iceCandidateCount}`);
    console.log(`   SDP Signals: ${sdpSignalCount}`);
    console.log('');

    // 确认删除
    if (!options.force) {
      console.log('⚠️  警告：此操作将删除以下数据：');
      console.log(`   - ${roomCount} 个房间`);
      console.log(`   - ${userCount} 条用户记录`);
      console.log(`   - ${messageCount} 条聊天消息`);
      console.log(`   - ${iceCandidateCount} 条 ICE Candidate 记录`);
      console.log(`   - ${sdpSignalCount} 条 SDP Signal 记录`);
      console.log('');
      console.log('❗ 此操作不可恢复！\n');

      const confirmed = await askConfirmation('确定要继续吗？');

      if (!confirmed) {
        console.log('❌ 操作已取消');
        rl.close();
        process.exit(0);
      }
    }

    // 开始事务删除
    console.log('\n🔄 开始删除...\n');

    await sequelize.transaction(async (t) => {
      const roomIds = rooms.map(r => r.id);

      // 删除相关数据（按照外键依赖顺序）
      console.log('  删除 ICE Candidates...');
      const deletedIce = await IceCandidate.destroy({
        where: { room_id: roomIds },
        transaction: t
      });
      console.log(`  ✅ 删除了 ${deletedIce} 条 ICE Candidate 记录`);

      console.log('  删除 SDP Signals...');
      const deletedSdp = await SdpSignal.destroy({
        where: { room_id: roomIds },
        transaction: t
      });
      console.log(`  ✅ 删除了 ${deletedSdp} 条 SDP Signal 记录`);

      console.log('  删除聊天消息...');
      const deletedMessages = await Message.destroy({
        where: { room_id: roomIds },
        transaction: t
      });
      console.log(`  ✅ 删除了 ${deletedMessages} 条聊天消息`);

      console.log('  删除用户记录...');
      const deletedUsers = await User.destroy({
        where: { room_id: roomIds },
        transaction: t
      });
      console.log(`  ✅ 删除了 ${deletedUsers} 条用户记录`);

      console.log('  删除房间记录...');
      const deletedRooms = await Room.destroy({
        where: whereClause,
        transaction: t
      });
      console.log(`  ✅ 删除了 ${deletedRooms} 个房间`);
    });

    console.log('\n✅ 删除完成！');
    console.log(`\n📊 总结：`);
    console.log(`   - 删除了 ${roomCount} 个房间`);
    console.log(`   - 删除了 ${userCount} 条用户记录`);
    console.log(`   - 删除了 ${messageCount} 条聊天消息`);
    console.log(`   - 删除了 ${iceCandidateCount} 条 ICE Candidate 记录`);
    console.log(`   - 删除了 ${sdpSignalCount} 条 SDP Signal 记录`);

  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  } finally {
    rl.close();
    await sequelize.close();
  }
}

// 显示帮助信息
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
清除数据库房间记录工具

使用方法:
  node scripts/clear-rooms.js [选项]

选项:
  --all          删除所有房间（包括活跃和非活跃）
  --inactive     只删除非活跃房间（默认）
  --force        跳过确认提示，直接删除
  --help, -h     显示此帮助信息

示例:
  # 删除所有非活跃房间（带确认提示）
  node scripts/clear-rooms.js

  # 删除所有房间（包括活跃的）
  node scripts/clear-rooms.js --all

  # 删除所有房间，跳过确认
  node scripts/clear-rooms.js --all --force

  # 只删除非活跃房间，跳过确认
  node scripts/clear-rooms.js --inactive --force

注意:
  - 此操作会删除房间及其所有相关数据（用户、消息、信令）
  - 删除操作不可恢复，请谨慎使用
  - 建议在删除前备份数据库
`);
  process.exit(0);
}

// 运行清除程序
clearRooms();
