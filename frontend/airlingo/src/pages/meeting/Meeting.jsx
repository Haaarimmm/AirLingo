/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-shadow */
/* eslint-disable no-case-declarations */
import styled from "@emotion/styled";
import { useEffect, useState, useRef } from "react";
import { OpenVidu } from "openvidu-browser";
import { useDispatch, useSelector } from "react-redux";
import stomp from "stompjs";
import SockJS from "sockjs-client";
import { ChatSlideMenu, ScriptSlideMenu } from "@/components/common/slideMenu";
import theme from "@/assets/styles/Theme";
import { FabButton, TextButton } from "@/components/common/button";
import * as Icons from "@/assets/icons";
import { AddDidReport, AddMeetingData, selectMeeting } from "@/features/Meeting/MeetingSlice";
import {
    getCard,
    getCardCode,
    getGrade,
    postOpenviduToken,
    postEvaluate,
    postCreateChatRoom,
} from "@/api";
import Overlay from "@/components/common/overlay";
import Modal from "@/components/modal";
import Dropdown from "@/components/common/dropdown";
import { getReportItems, postReport } from "@/api/report";
import { TextArea } from "@/components/common/input";
import { selectUser } from "@/features/User/UserSlice";
import { postScript } from "@/api/record";
import { formatGrade, formatReportItem } from "@/utils/format";
import { ExitIcon, DictionaryIcon } from "@/assets/icons";
import StarRate from "@/components/starRate";
import { useRouter } from "@/hooks";
import ChatList from "@/components/chatList/ChatList";
import isKeyInObj from "@/utils/common";

// ----------------------------------------------------------------------------------------------------

const { primary1 } = theme.colors;
const contentGroupData = [
    { Content: () => <div>Content1</div>, Icon: Icons.ScriptIcon },
    { Content: () => <div>Content2</div>, Icon: Icons.DictionaryIcon },
    { Content: () => <div>Content3</div>, Icon: Icons.TranslatorIcon },
];

// ----------------------------------------------------------------------------------------------------

function Meeting() {
    const dispatch = useDispatch();
    const { routeTo } = useRouter();
    const { sessionId, meetingData, didReport, otherUser, studyId } = useSelector(selectMeeting);
    const { userId, userNickname, userImgUrl } = useSelector(selectUser);

    const [localRecorder, setLocalRecorder] = useState(null);
    const [reportList, setReportList] = useState([]);
    const [cardCode, setCardCode] = useState([]);
    const [session, setSession] = useState(null); // Initial value changed to null
    const [publisher, setPublisher] = useState(null);

    const [subscribers, setSubscribers] = useState([]);
    const [isActiveMic, setIsActiveMic] = useState(false);
    const [isActiveVideo, setIsActiveVideo] = useState(false);
    const [activeButton, setActiveButton] = useState(null);
    const [isActiveSlide, setIsActiveSlide] = useState(false);
    const [isActiveChatSlide, setIsActiveChatSlide] = useState(false);
    const [anotherConnection, setAnotherConnection] = useState({});
    const [openResponseWaitModal, setOpenResponseWaitModal] = useState(false);
    const [openCardModal, setOpenCardModal] = useState(false); // 카드 모달의 on/off
    const [openCardRequestModal, setOpenCardRequestModal] = useState(false); // 상대방이 선택한 대주제를 허용할지 묻는 모달 on/off
    const [requestCardCode, setRequestCardCode] = useState("");

    const [openReportModal, setOpenReportModal] = useState(false); // 신고 모달의 on/off
    const [reportState, setReportState] = useState({});
    const [reportText, setReportText] = useState("");
    const [openReportConfirmModal, setOpenReportConfirmModal] = useState(false);

    const [openFeedbackStartModal, setOpenFeedbackStartModal] = useState(false);
    const [openFeedbackRequestModal, setOpenFeedbackRequestModal] = useState(false);
    const [isRecordingUser, setIsRecordingUser] = useState(false);

    const [openEvaluateModal, setOpenEvaluateModal] = useState(false);
    const [rating, setRating] = useState(0);
    const [grade, setGrade] = useState([]);
    const [selectedGrade, setSelectedGrade] = useState({});

    const [message, setMessage] = useState("");
    const [chatMessage, setChatMessages] = useState([]);
    const stompCilent = useRef({});
    const { VITE_CHAT_SOCKET_URL } = import.meta.env;

    const OV = useRef(new OpenVidu());

    // 필요 데이터를 불러오는 함수
    async function fetchData() {
        await getCardCode({
            responseFunc: {
                200: (response) => {
                    setCardCode([...response.data.data]);
                },
            },
        });

        await getReportItems({
            responseFunc: {
                200: (response) => {
                    setReportList([...response.data.data].map((cur) => formatReportItem(cur)));
                },
            },
            data: { languageCode: "KOR" },
        });

        await getGrade({
            responseFunc: {
                200: (response) => {
                    setGrade([...response.data.data]);
                },
            },
        });
    }

    async function joinSession() {
        const curSession = OV.current.initSession();

        curSession.on("streamCreated", (event) => {
            console.log("스트림 여는 이벤트");
            const subscriber = curSession.subscribe(event.stream, undefined);
            setSubscribers([subscriber]);
            setAnotherConnection(subscriber.stream.connection);
        });

        curSession.on("streamDestroyed", (event) => {
            console.log("스트림 삭제 이벤트", subscribers, event.stream.streamId);

            setSubscribers((prevSubscribers) =>
                prevSubscribers.filter((sub) => sub.stream.streamId !== event.stream.streamId),
            );
            // setSubscribers([]);
        });

        curSession.on("exception", (exception) => {
            console.warn(exception);
        });

        curSession.on("connectionCreated", (event) => {
            console.log("커넥션 여는 이벤트");
            setAnotherConnection(event.connection);
        });

        curSession.on("signal", (event) => {
            const { data, type } = event;
            const typeArr = type.split(":");
            const processSignal = async () => {
                switch (typeArr[1]) {
                    case "cardcode-select-request":
                        setOpenCardRequestModal(true);
                        setRequestCardCode(data);
                        break;

                    case "cardcode-select-response":
                        console.log(
                            "카드 선택에 대한 답을 받았다!",
                            localRecorder,
                            anotherConnection,
                        );
                        // if (localRecorder) {
                        // localRecorder가 존재하는 경우만 처리
                        const jsonData = JSON.parse(data);
                        if (jsonData.agree) {
                            dispatch(
                                AddMeetingData({
                                    meetingData: {
                                        ...meetingData,
                                        currentCardCode: jsonData.currentCardCode,
                                        currentCard: jsonData.currentCard,
                                    },
                                }),
                            );

                            setIsRecordingUser(true);
                            console.log("OpenResponseWaitModal 닫기!!!", publisher);
                            setOpenResponseWaitModal(false);

                            const recorder = OV.current.initLocalRecorder(publisher.stream);
                            await recorder.record({
                                mimeType: "video/webm;codecs=vp8",
                                audioBitsPerSecond: 128000,
                                videoBitsPerSecond: 2500000,
                            });
                            console.log("레코더가 바로 이거임.", recorder);
                            setLocalRecorder(recorder);
                        } else {
                            console.log("상대가 내 카드 코드 선택에 동의하지 않았습니다");
                        }
                        // }
                        break;

                    case "feedback-start-request":
                        // 1. 응답 모달창을 열어준다.
                        setOpenFeedbackRequestModal(true);
                        break;

                    case "feedback-start-response":
                        console.log(localRecorder, "여기까지 오긴 왔긴 했어");
                        if (localRecorder) {
                            // localRecorder가 존재하는 경우만 처리
                            const jsonData = JSON.parse(data);
                            if (jsonData.agree && isRecordingUser) {
                                await localRecorder.stop(); // 현재 녹음하던 것을 끝낸다.
                                const recordedBlob = await localRecorder.getBlob();

                                const formData = new FormData()
                                    .append("studyId", "135")
                                    .append("cardId", meetingData.currentCardCode)
                                    .append("voiceFile", recordedBlob);

                                await postScript({
                                    responseFunc: {},
                                    data: formData,
                                });
                            } else {
                                console.log("거절 또는 당신은 요청을 보낸 사람입니다.");
                            }
                        }
                        break;

                    default:
                        console.log("없는 이벤트타입입니다.");
                }
            };
            processSignal();
        });

        setSession(curSession);
    }

    console.log(localRecorder);

    // 세션 연결 함수
    async function connectSession() {
        if (!session) return;
        const response = await postOpenviduToken({
            responseFunc: {
                200: () => console.log("get Token Success"),
                400: () => console.log("get Token Fail"),
            },
            data: { sessionId },
        });

        session
            .connect(response.data.data, {
                clientData: userNickname,
            })
            .then(async () => {
                const publisher = await OV.current.initPublisherAsync(undefined, {
                    audioSource: undefined,
                    videoSource: undefined,
                    publishAudio: true,
                    publishVideo: true,
                    resolution: "1280x720",
                    frameRate: 60,
                    insertMode: "APPEND",
                    mirror: "false",
                });
                session.publish(publisher);
                setPublisher(publisher);

                if (session && isKeyInObj(session, "connection")) {
                    session.connections.forEach((connection) => {
                        if (connection.connectionId !== session.connection.connectionId) {
                            console.log("상대방의 Connection 발견!", connection);
                            setAnotherConnection(connection);
                        }
                    });
                }
            })
            .catch((error) => {
                console.error("Error Connecting to OpenVidu", error);
            });
    }

    /* ------------------ chat ------------------ */
    function onConnected() {
        console.log(`개인 구독 !!${sessionId}`);
        // user 개인 구독
        stompCilent.current.subscribe(`/sub/chat/room/${sessionId}`, function (message) {
            setChatMessages((messages) => [...messages, JSON.parse(message.body)]);

            console.log(message.body);
        });
    }

    function connect() {
        const socket = new SockJS(VITE_CHAT_SOCKET_URL);
        stompCilent.current = stomp.over(socket);
        console.log(stompCilent);
        console.log(stompCilent.current);
        stompCilent.current.connect({}, () => {
            setTimeout(function () {
                onConnected();
            }, 500);
        });
        console.log(stompCilent.current.connected);
    }

    const ChangeMessages = (event) => {
        setMessage(event.target.value);
    };

    const sendMessage = async (e) => {
        e.preventDefault();
        await stompCilent.current.send(
            "/pub/chat/message",
            {},
            JSON.stringify({
                roomId: sessionId,
                userNickname,
                content: message,
                userImgUrl,
            }),
        );
        setMessage("");
    };

    const createChatRoom = async () => {
        await postCreateChatRoom({
            responseFunc: {
                200: (response) => {
                    console.log("채팅방 생성 성공!");
                    console.log(response.data);
                },
                400: () => {
                    console.log("실패!");
                },
            },
            data: sessionId,
        });

        connect();
    };

    /* ------------------ useEffect Area ------------------ */
    useEffect(() => {
        fetchData();
        joinSession();
        createChatRoom();
        return () => {
            if (session) session.disconnect();
        };
    }, []);

    useEffect(() => {
        if (session) {
            connectSession();
        }
    }, [session]);

    const handleMicClick = () => {
        setIsActiveMic((prevState) => !prevState);
        console.log("Microphone");
    };

    const handleVideoClick = () => {
        setIsActiveVideo((prevState) => !prevState);
        console.log("Video");
    };

    const handleChatClick = () => {
        setIsActiveChatSlide((prev) => !prev);
        console.log("hi");
        setActiveButton((prevButtonName) => {
            if (prevButtonName === "Chat") return null;
            return "Chat";
        });
        console.log("ChatSlide");
    };

    const handleBoardClick = () => {
        setActiveButton((prevButtonName) => {
            if (prevButtonName === "Board") return null;
            return "Board";
        });
        console.log("Board");
    };

    const handleShareClick = () => {
        setActiveButton((prevButtonName) => {
            if (prevButtonName === "Share") return null;
            return "Share";
        });
        console.log("Share");
    };

    const handleCardClick = () => {
        setActiveButton((prevButtonName) => {
            if (prevButtonName === "Card") return null;
            return "Card";
        });

        // 1. 카드를 보여준다. 그러기 위해서는 상태를 on/off 해야한다.
        setOpenCardModal((prev) => !prev);
    };

    const handleReportClick = () => {
        // 1. 현재 사용자가, 상대방을 이미 신고한 전적이 있는지 확인한다.
        if (didReport) {
            setActiveButton((prevButtonName) => {
                if (prevButtonName === "Report") return null;
                return "Report";
            });
        }

        setOpenReportModal((prev) => !prev);
    };

    const handleExitClick = () => {
        setActiveButton((prevButtonName) => {
            if (prevButtonName === "Exit") return null;
            return "Exit";
        });

        // 평가하기 모달을 띄워줘야 한다.
        setOpenEvaluateModal(true);
        console.log("Exit");
    };

    const handleClickSlideButton = () => {
        setIsActiveSlide((prev) => !prev);
    };

    const handleClickTopicCard = (e) => {
        const closestCard = e.target.closest("button");
        if (!closestCard) return;

        // 1. 현재 카드를 인지했고, 해당 카드에서 정보를 가져온다.
        const cardCode = closestCard.id;
        // 2. 가져온 정보를 통해서 상대방에게 현재 대주제로 할 것인지 고르라고 한다.
        session.signal({
            data: cardCode,
            to: [subscribers[0].stream.connection],
            type: "cardcode-select-request",
        });
        // 3. 일단 현재 카드 선택 창은 닫는다.
        handleCardClick();

        // 4. 또한, 상대방의 응답을 받을 때까지 대기하는 모달 창을 띄워줘야 한다.
        setOpenResponseWaitModal(true);
    };
    console.log(otherUser);

    const handleClickCardRequestAgree = async () => {
        // 상대방이 정한 대화 대주제에 동의할 때 발생되는 이벤트
        // 1. 해당 대화 대주제에 대한 세부 주제를 얻기 위한 요청을 보낸다.
        await getCard({
            responseFunc: {
                200: (response) => {
                    // 정상 요청 성공의 경우, redux store 안에다가 {현재 선택한 카드 대주제, 대주제에 따른 소주제} 를 저장한다.
                    dispatch(
                        AddMeetingData({
                            meetingData: {
                                ...meetingData,
                                currentCardCode: requestCardCode,
                                currentCard: response.data.data.subject,
                            },
                        }),
                    );
                    // 상대방도 저장할 수 있도록, 내가 스토어에 저장한 것과 동일한 데이터를 보내준다.
                    console.log(anotherConnection, subscribers);
                    session.signal({
                        data: JSON.stringify({
                            agree: true,
                            currentCardCode: requestCardCode,
                            currentCard: response.data.data.subject,
                        }),
                        to: [subscribers[0].stream.connection],
                        type: "cardcode-select-response",
                    });
                },
            },
            data: {
                cardCode: requestCardCode,
                languageCode: "KOR",
            },
        });
        setOpenCardRequestModal(false);
    };

    const handleClickReportUser = async () => {
        await postReport({
            responseFunc: {
                200: () => {
                    console.log("신고 성공!");
                    // 2. 신고 모달의 상태를 변경한다.
                    setOpenReportModal((prev) => !prev);
                    setOpenReportConfirmModal(true);
                },
            },
            data: {
                reportItemId: reportState.id,
                userId,
                description: reportText,
            },
        });
        dispatch(AddDidReport(true));
    };

    const handleClickOpenFeedback = async () => {
        // 피드백 시작을 요청하는 창을 연다.
        setOpenFeedbackStartModal(true);

        // 상대방에게 피드백 시작을 요청한다.
        session.signal({
            data: "",
            to: [subscribers[0].stream.connection],
            type: "feedback-start-request",
        });
    };

    const handleClickOpenFeedbackConfirm = (agree) => {
        // 상대방에게 피드백 시착에 따른 동의/거절 여부를 보내준다.
        session.signal({
            data: JSON.stringify({ agree }),
            to: [],
            type: "feedback-start-response",
        });

        // 피드백 요청 확인 창을 닫는다.
        openFeedbackStartModal(false);
    };

    const handleClickEvaluateUser = async () => {
        // gradeId : 실력점수, rating : 매너점수
        await postEvaluate({
            responseFunc: {
                200: () => {
                    session.disconnect();
                    routeTo("/matchhome", { replace: false });
                },
            },
            data: {
                userId: otherUser.userId,
                gradeId: selectedGrade.gradeId,
                languageId: otherUser.userStudyLanguageId,
                studyId,
                rating,
            },
        });
    };
    console.log(subscribers);
    const buttonList = [
        {
            buttonName: "Microphone",
            icon: isActiveMic ? Icons.MicOffIcon : Icons.MicOnIcon,
            onClick: handleMicClick,
            category: isActiveMic ? "active" : "white",
            iconColor: isActiveMic ? "white" : "black",
        },
        {
            buttonName: "Video",
            icon: isActiveVideo ? Icons.VideoOffIcon : Icons.VideoOnIcon,
            onClick: handleVideoClick,
            category: isActiveVideo ? "active" : "white",
            iconColor: isActiveVideo ? "white" : "black",
        },
        {
            buttonName: "Chat",
            icon: Icons.ChatIcon,
            onClick: handleChatClick,
            category: activeButton === "Chat" ? "active" : "white",
            iconColor: activeButton === "Chat" ? "white" : "black",
        },
        {
            buttonName: "Board",
            icon: Icons.BoardIcon,
            onClick: handleBoardClick,
            category: activeButton === "Board" ? "active" : "white",
            iconColor: activeButton === "Board" ? "white" : "black",
        },
        {
            buttonName: "Share",
            icon: Icons.ShareIcon,
            onClick: handleShareClick,
            category: activeButton === "Share" ? "active" : "white",
            iconColor: activeButton === "Share" ? "white" : "black",
        },
        {
            buttonName: "Card",
            icon: Icons.CardIcon,
            onClick: handleCardClick,
            category: activeButton === "Card" ? "active" : "white",
            iconColor: activeButton === "Card" ? "white" : "black",
        },
        {
            buttonName: "Report",
            icon: Icons.ReportIcon,
            onClick: handleReportClick,
            category: activeButton === "Report" ? "active" : "red",
            iconColor: "white",
        },
        {
            buttonName: "Exit",
            icon: Icons.ExitIcon,
            onClick: handleExitClick,
            category: activeButton === "Exit" ? "active" : "red",
            iconColor: "white",
        },
    ];

    return (
        <MeetingContainer>
            {openCardModal && (
                <Overlay zIdx={2}>
                    <CardModalContainer>
                        <TopicCardBox onClick={handleClickTopicCard}>
                            {cardCode.map((cur) => (
                                <TopicCard id={cur.code}>
                                    <TopicCardTitle>{cur.korSubject}</TopicCardTitle>
                                    <TopicCardSubTitle>{cur.engSubject}</TopicCardSubTitle>
                                </TopicCard>
                            ))}
                        </TopicCardBox>
                    </CardModalContainer>
                </Overlay>
            )}
            {openCardRequestModal && (
                <Modal zIdx={4} Icon={DictionaryIcon} title="대화 주제 선택 요청">
                    <ModalTextBox>
                        <div>
                            <ModalTextWrapper color="black">
                                상대방이
                                <ModalTextWrapper color="red"> {requestCardCode} </ModalTextWrapper>
                                를 대화 대주제로 선택했습니다.
                            </ModalTextWrapper>
                        </div>
                        <ModalTextWrapper>
                            동의 시, 대주제에 대한 세부주제가 선택됩니다.
                        </ModalTextWrapper>
                    </ModalTextBox>
                    <ModalButtonBox>
                        <TextButton
                            shape="positive-curved"
                            text="동의"
                            onClick={handleClickCardRequestAgree}
                        />
                        <TextButton
                            shape="positive-curved"
                            text="거절"
                            onClick={() => setOpenCardRequestModal(false)}
                        />
                    </ModalButtonBox>
                </Modal>
            )}
            {openResponseWaitModal && (
                <Modal zIdx={4} Icon={DictionaryIcon} title="상대방의 응답 대기">
                    <ModalTextBox>
                        <ModalTextWrapper>상대방의 응답을 대기중입니다...</ModalTextWrapper>
                    </ModalTextBox>
                </Modal>
            )}
            {openReportModal && (
                <Modal
                    zIdx={4}
                    Icon={DictionaryIcon}
                    title="신고하기"
                    iconColor="red"
                    titleColor="red"
                >
                    <ModalTextWrapper weight="400px">
                        해당 랭커를 다음과 같은 사유로 신고하시겠습니까?
                    </ModalTextWrapper>
                    <ModalContentBox>
                        <ModalTextWrapper weight="700px">신고 사유</ModalTextWrapper>
                        <Dropdown
                            width="400px"
                            placeholder="신고 사유를 선택해주세요"
                            onChange={setReportState}
                            selectedOption={reportState}
                            data={reportList}
                        />
                    </ModalContentBox>
                    <ModalContentBox>
                        <ModalTextWrapper weight="700px">상세 내용</ModalTextWrapper>
                        <TextArea
                            placeholder="상세 내용을 작성해주세요."
                            radius="big"
                            height="300px"
                            value={reportText}
                            onChange={setReportText}
                        />
                    </ModalContentBox>
                    <ModalButtonBox>
                        <TextButton
                            shape="positive-curved"
                            text="신고"
                            onClick={handleClickReportUser}
                        />
                        <TextButton
                            shape="positive-curved"
                            text="취소"
                            onClick={() => setOpenReportModal(false)}
                        />
                    </ModalButtonBox>
                </Modal>
            )}
            {openReportConfirmModal && (
                <Modal
                    zIdx={4}
                    Icon={DictionaryIcon}
                    title="신고하기"
                    iconColor="red"
                    titleColor="red"
                >
                    <ModalTextWrapper weight="400px">
                        해당 랭커에 대한 신고가 정상적으로 접수되었습니다.
                    </ModalTextWrapper>
                    <ModalButtonBox>
                        <TextButton
                            shape="positive-curved"
                            text="확인"
                            onClick={() => setOpenReportConfirmModal(false)}
                        />
                    </ModalButtonBox>
                </Modal>
            )}
            {openFeedbackStartModal && (
                <Modal zIdx={4} Icon={DictionaryIcon} title="스크립트 피드백 요청">
                    <ModalTextWrapper weight="400px">
                        상대방에게 스크립트 피드백 요청을 보냈습니다.
                    </ModalTextWrapper>
                </Modal>
            )}
            {openFeedbackRequestModal && (
                <Modal zIdx={4} Icon={DictionaryIcon} title="스크립트 피드백 요청">
                    <ModalTextBox>
                        <ModalTextWrapper weight="400px">
                            상대방으로부터 스크립트 피드백 요청을 받았습니다.
                        </ModalTextWrapper>
                        <ModalTextWrapper weight="400px">
                            스크립트 피드백을 진행하시겠습니까?
                        </ModalTextWrapper>
                    </ModalTextBox>
                    <ModalButtonBox>
                        <TextButton
                            shape="positive-curved"
                            text="수락"
                            onClick={() => handleClickOpenFeedbackConfirm(true)}
                        />
                        <TextButton
                            shape="positive-curved"
                            text="거절"
                            onClick={() => handleClickOpenFeedbackConfirm(false)}
                        />
                    </ModalButtonBox>
                </Modal>
            )}

            {openEvaluateModal && (
                <Modal zIdx={4} Icon={ExitIcon} title="상대 랭커 평가하기">
                    <ModalTextWrapper weight="400px">
                        상대 랭커의 매너와 언어 실력에 대해서 평가를 남겨주세요!
                    </ModalTextWrapper>
                    <ModalContentBox>
                        <ModalTextWrapper weight="700px">매너 점수</ModalTextWrapper>
                        <StarRate rating={rating} setRating={setRating} />
                    </ModalContentBox>
                    <ModalContentBox>
                        <ModalTextWrapper weight="700px">실력 점수</ModalTextWrapper>
                        <Dropdown
                            width="400px"
                            placeholder="실력 점수를 선택해주세요"
                            onChange={setSelectedGrade}
                            selectedOption={selectedGrade}
                            data={grade.map((cur) => formatGrade(cur))}
                        />
                    </ModalContentBox>
                    <ModalButtonBox>
                        <TextButton
                            shape="positive-curved"
                            text="나가기"
                            onClick={handleClickEvaluateUser}
                        />
                        <TextButton
                            shape="positive-curved"
                            text="취소"
                            onClick={() => setOpenEvaluateModal(false)}
                        />
                    </ModalButtonBox>
                </Modal>
            )}
            <VideoContainer>
                <VideoFrame>
                    {publisher ? (
                        <video
                            ref={(node) => node && publisher.addVideoElement(node)}
                            autoPlay
                            width="500px"
                        />
                    ) : (
                        <PlacholderBox>카메라를 로딩하고 있습니다.</PlacholderBox>
                    )}
                </VideoFrame>
                {subscribers.map((subscriber) => (
                    <VideoFrame key={subscriber.stream.streamId}>
                        <video
                            ref={(node) => node && subscriber.addVideoElement(node)}
                            autoPlay
                            width="500px"
                        />
                    </VideoFrame>
                ))}
            </VideoContainer>
            <TopicContainer>
                <TopicHeader>현재 대화 주제</TopicHeader>
                <TopicContent>{meetingData ? meetingData.currentCard : "없음"}</TopicContent>
                <TextButton
                    shape="positive-curved-large"
                    type="button"
                    onClick={handleClickOpenFeedback}
                    text="스크립트 피드백"
                />
            </TopicContainer>
            <ButtonMenu isActiveSlide={isActiveSlide} isActiveChatSlide={isActiveChatSlide}>
                {buttonList.map(({ buttonName, icon, onClick, category, iconColor }) => (
                    <FabButton
                        key={buttonName}
                        icon={icon}
                        onClick={onClick}
                        category={category}
                        iconColor={iconColor}
                    />
                ))}
            </ButtonMenu>
            <ScriptSlideMenu
                contentGroup={contentGroupData}
                onClick={handleClickSlideButton}
                slideOpen={isActiveSlide}
            />
            <ChatSlideMenu isOpen={isActiveChatSlide}>
                <ChatList data={chatMessage} />
                <ChatInputWrapper onSubmit={sendMessage}>
                    <ChatInput
                        value={message}
                        onChange={ChangeMessages}
                        placeholder="대화 상대방에게 채팅을 보내보세요!"
                    />
                </ChatInputWrapper>
            </ChatSlideMenu>
        </MeetingContainer>
    );
}

// ----------------------------------------------------------------------------------------------------

const MeetingContainer = styled.div`
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: start;
    align-items: center;
    background-color: ${primary1};
    font-family: "Pretendard";
`;

const VideoContainer = styled.div`
    display: flex;
    align-items: start;
    gap: 10px;
    margin: 10px 0;
`;

const VideoFrame = styled.div`
    width: 500px;
`;

const PlacholderBox = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    width: 500px;
    height: 281.25px;
    background-color: black;
    border-radius: 20px;
    color: white;
`;

const TopicContainer = styled.div`
    display: flex;
    width: 1010px;
    height: 300px;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border-radius: 20px;
    background-color: #ffffff;
    box-shadow: 0px 5px 5px 0px rgba(0, 0, 0, 0.25) inset;
    gap: 5px;
`;

const TopicHeader = styled.div`
    font-weight: 300;
    font-size: 30px;
`;

const TopicContent = styled.div`
    font-weight: 700;
    font-size: 50px;
`;

const ButtonMenu = styled.div`
    position: fixed;
    display: flex;
    height: fit-content;
    flex-shrink: 0;
    right: ${({ isActiveSlide }) => (isActiveSlide ? "500px" : "300px")};
    bottom: ${({ isActiveChatSlide }) => (isActiveChatSlide ? "460px" : "0px")};
    transition: 0.3s ease-in-out;
    margin-bottom: 20px;
    gap: 20px;
    z-index: 3;
    transform: translate(-50%, 0);
`;

const TopicCardBox = styled.div`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(4, 1fr);
    gap: 20px; // 각 카드 사이의 간격을 조절하려면 여기 값을 변경하세요
    align-items: center;
    align-content: center;
    width: 80%;
    height: 70%;
    justify-content: center;
`;

const CardModalContainer = styled.div`
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: start;
    align-items: center;
    flex-direction: column;
    margin-top: 30px;
`;

const TopicCard = styled.button`
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;
    border-radius: 20px;
    background: #d9d9d9;
    box-shadow: 0px 0px 10px 0px rgba(0, 0, 0, 0.75);
    cursor: pointer;
    width: 100%;
    height: 100%;
`;

const TopicCardTitle = styled.span`
    color: #000;
    text-align: center;
    font-size: 40px;
    font-weight: 700;
    line-height: normal;
`;
const TopicCardSubTitle = styled.span`
    color: #000;
    text-align: center;
    font-size: 20px;
    font-weight: 400;
    line-height: normal;
`;

const ModalTextBox = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
`;

const ModalContentBox = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: row;
    gap: 50px;
`;

const ModalTextWrapper = styled.span`
    color: ${({ color }) => color};
    text-align: center;
    font-size: 25px;
    font-weight: ${({ weight }) => weight};
    line-height: 44px;
`;

const ModalButtonBox = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 50px;
`;

const ChatInputWrapper = styled.form`
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    border-radius: 10px;
    border: 1px solid #000;
    padding: 10px 20px;
    box-sizing: border-box;
    font-size: 25px;
    font-weight: 400;
    line-height: normal;
`;

const ChatInput = styled.input`
    width: 900%;
    border: none;
    font-size: 25px;
    line-height: normal;
`;

// ----------------------------------------------------------------------------------------------------

export default Meeting;
